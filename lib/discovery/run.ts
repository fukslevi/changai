import { and, eq, isNull, sql } from "drizzle-orm";
import { db, projects, requirements, supplierLeads } from "../db";
import { enrichDomain } from "./enrich";
import { scoreCandidates, type Candidate } from "./score";
import { findCandidates } from "./search";

export interface DiscoveryResult {
  searched: number;
  enriched: number;
  withEmail: number;
  saved: number;
}

/** Enrichment hits third-party sites; a few at a time keeps it civil and fast. */
const ENRICH_CONCURRENCY = 5;

/**
 * Below this the candidate is a retailer, a news site or a marketplace - Target
 * and the New York Times both turned up on a bike-basket search. Storing them
 * only makes the operator scroll past thirty rows to reach the five that matter.
 */
const MIN_SCORE_TO_STORE = 20;

/**
 * How many usable leads a project should end up with.
 *
 * One search pass produced nine, which is a shortlist you can lose to four
 * refusals. Reply rates on cold sourcing run around a third, and of those only
 * some quote at all - so the number of conversations worth having is a fraction
 * of a fraction, and the fraction has to start large enough.
 */
export const TARGET_LEADS = 30;

/**
 * Extra angles to search when the first pass falls short.
 *
 * A factory describes itself by material, process and market, and the operator's
 * keywords usually cover only one of those. These add the others rather than
 * repeating the same query with more pages, which returns the same companies.
 *
 * The regional ones earn their place: a Chinese manufacturer's own site names
 * its province far more reliably than it uses the word "OEM", and the clusters
 * are real - metalwork in Guangdong and Zhejiang, lighting in Zhongshan.
 */
const BROADENING_SUFFIXES = [
  "OEM factory",
  "wholesale supplier China",
  "manufacturer Alibaba",
  "supplier export",
  "factory price",
  "custom manufacturer",
  "ODM manufacturer",
  "Guangdong factory",
  "Zhejiang manufacturer",
  "Ningbo supplier",
  "trading company export China",
  "contract manufacturer China",
];

/**
 * Passes before the shortlist is accepted as final.
 *
 * One per angle, plus the operator's own keywords. It used to be four - fewer
 * than the angles available - so the search gave up having tried a third of
 * what it knew how to try. A product with few manufacturers still ends early,
 * because every round stops as soon as the target is reached.
 */
export const MAX_DISCOVERY_RUNS = BROADENING_SUFFIXES.length + 1;

async function inBatches<T, R>(
  items: T[],
  size: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  }
  return out;
}


/**
 * Try again for the leads with no address.
 *
 * A lead nobody can write to is not a lead, and a third of what discovery
 * stores lands that way - the site was slow, the contact page was an image, the
 * form had no mailto behind it. They then sit in the list forever looking like
 * progress: nineteen suppliers found, nine that can actually be contacted.
 *
 * Worth retrying rather than writing off, because the extraction itself keeps
 * improving - several of these were stored by a version that stripped `www.`
 * and guessed paths instead of following the site's own links.
 */
export async function reenrichMissing(
  projectId: string,
  options: { limit?: number; deadline?: number } = {},
): Promise<{ tried: number; found: number }> {
  const limit = options.limit ?? 8;

  const missing = await db
    .select({ id: supplierLeads.id, domain: supplierLeads.domain, url: supplierLeads.sourceUrl })
    .from(supplierLeads)
    .where(and(eq(supplierLeads.projectId, projectId), isNull(supplierLeads.email)))
    .limit(limit);

  let found = 0;
  let tried = 0;

  for (const lead of missing) {
    if (options.deadline && Date.now() > options.deadline) break;
    tried++;

    try {
      const contact = await enrichDomain(lead.domain, { seedUrl: lead.url ?? undefined });
      if (!contact.primaryEmail) continue;

      await db
        .update(supplierLeads)
        .set({ email: contact.primaryEmail })
        .where(eq(supplierLeads.id, lead.id));
      found++;
    } catch {
      // A site that will not answer is not a failure worth stopping for.
    }
  }

  return { tried, found };
}

/**
 * keywords -> search -> company site -> email -> score -> pending leads.
 *
 * Nothing here contacts anyone. Every lead lands as `pending` for the operator
 * to approve or reject; that gate is the whole point of the flow.
 */
export async function runDiscovery(
  projectId: string,
  options: { target?: number; maxRounds?: number; deadline?: number } = {},
): Promise<DiscoveryResult> {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) throw new Error("Project not found");
  if (project.keywords.length === 0) throw new Error("Add keywords before running discovery");

  const target = options.target ?? TARGET_LEADS;
  const maxRounds = options.maxRounds ?? MAX_DISCOVERY_RUNS;

  /*
   * Where this call starts is where the last one stopped.
   *
   * This is the bug that kept every project at nineteen leads. The round index
   * was a loop counter that restarted at zero on every call, and the scheduled
   * top-up asked for one round - so round was always 0, which is the branch
   * that uses the operator's keywords unchanged. Four scheduled rounds ran the
   * identical original query four times, found the identical companies, and
   * spent the whole budget without ever using a single broadening angle.
   *
   * Reading the offset from the project makes the counter mean what its name
   * always claimed: how many angles have been tried.
   */
  const startRound = project.discoveryRuns ?? 0;

  const already = await db
    .select({ domain: supplierLeads.domain, email: supplierLeads.email })
    .from(supplierLeads)
    .where(eq(supplierLeads.projectId, projectId));

  const seenDomains = new Set(already.map((r) => r.domain));

  /*
   * The target counts leads we can actually write to.
   *
   * Counting raw candidates stopped the search at 28 stored leads: it saw
   * thirty domains in hand and called it done, before scoring dropped the
   * retailers and enrichment failed to find an address for a third of the
   * rest. A domain nobody can email is not a supplier on the list, so it does
   * not count towards a list of thirty.
   */
  const contactable = already.filter((r) => r.email).length;

  const hits: Awaited<ReturnType<typeof findCandidates>> = [];
  let roundsRun = 0;

  for (let i = 0; i < maxRounds; i++) {
    const round = startRound + i;
    if (round > BROADENING_SUFFIXES.length) break;
    if (contactable + hits.length >= target) break;
    // The cycle has a budget and search is the most expensive thing in it.
    // Stopping between rounds costs nothing: the next call resumes here.
    if (options.deadline && Date.now() > options.deadline) break;

    const keywords =
      round === 0
        ? project.keywords
        : project.keywords.map((k) => `${k} ${BROADENING_SUFFIXES[round - 1]}`);

    const found = await findCandidates(keywords);
    roundsRun++;
    for (const hit of found) {
      if (seenDomains.has(hit.domain)) continue;
      if (hits.some((h) => h.domain === hit.domain)) continue;
      hits.push(hit);
    }
  }

  const enriched = await inBatches(hits, ENRICH_CONCURRENCY, async (hit) => ({
    hit,
    // The search result URL is a host that is known to answer. Hits are stored
    // with `www.` stripped, and some hosts serve only the www form.
    contact: await enrichDomain(hit.domain, { seedUrl: hit.url }),
  }));

  const candidates: Candidate[] = enriched.map(({ hit, contact }) => ({
    domain: hit.domain,
    title: hit.title,
    snippet: hit.snippet,
    matchedQueries: hit.matchedQueries,
    companyText: contact.companyText,
  }));

  const projectRequirements = await db
    .select({ text: requirements.text })
    .from(requirements)
    .where(eq(requirements.projectId, projectId));

  const scores = await scoreCandidates(
    project.name,
    projectRequirements.map((r) => r.text),
    candidates,
  );
  const scoreByDomain = new Map(scores.map((s) => [s.domain, s]));

  // Replace previous pending leads; approved and rejected decisions survive so
  // a re-run never resurrects something the operator already turned down.
  const existing = await db
    .select({ domain: supplierLeads.domain, status: supplierLeads.status })
    .from(supplierLeads)
    .where(eq(supplierLeads.projectId, projectId));
  const decided = new Set(existing.filter((e) => e.status !== "pending").map((e) => e.domain));

  // Counted in angles actually tried, not calls made. A call that stopped on
  // its deadline before searching must not burn an angle it never used.
  await db
    .update(projects)
    .set({ discoveryRuns: startRound + roundsRun })
    .where(eq(projects.id, projectId));

  let saved = 0;
  for (const { hit, contact } of enriched) {
    const score = scoreByDomain.get(hit.domain);
    const companyName = score?.companyName?.trim() || hit.title || hit.domain;
    if (decided.has(hit.domain)) continue;
    if (score && score.score < MIN_SCORE_TO_STORE) continue;

    await db
      .insert(supplierLeads)
      .values({
        projectId,
        companyName,
        domain: hit.domain,
        website: `https://${hit.domain}`,
        email: contact.primaryEmail,
        country: score?.country ?? null,
        source: "search",
        sourceUrl: hit.url,
        matchScore: score ? Math.round(score.score) : null,
        matchRationale: score?.rationale ?? null,
        status: "pending",
      })
      .onConflictDoUpdate({
        target: [supplierLeads.projectId, supplierLeads.domain],
        set: {
          companyName,
          // A re-run must not wipe an address the operator typed in by hand.
          email: contact.primaryEmail ?? sql`${supplierLeads.email}`,
          matchScore: score ? Math.round(score.score) : null,
          matchRationale: score?.rationale ?? null,
          website: `https://${hit.domain}`,
          sourceUrl: hit.url,
        },
      });
    saved++;
  }

  return {
    searched: hits.length,
    enriched: enriched.filter((e) => e.contact.pagesFetched > 0).length,
    withEmail: enriched.filter((e) => e.contact.primaryEmail).length,
    saved,
  };
}
