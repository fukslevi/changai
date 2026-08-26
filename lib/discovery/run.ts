import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { db, projects, requirements, supplierLeads } from "../db";
import { generateAngles } from "./angles";
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
export const MIN_SCORE_TO_STORE = 20;

/**
 * The score at which a lead is written to without anyone looking.
 *
 * Shared with the auto-approval step on purpose: the target is a number of
 * outreaches, so the only leads that count towards it are the ones that will
 * actually become one.
 */
export const AUTO_APPROVE_SCORE = 30;

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

/** How many product-specific angles are generated in one batch. */
const MAX_GENERATED_ANGLES = 14;

/**
 * The search does not give up at a fixed number of rounds any more.
 *
 * A round cap is the wrong control: it stops a search that is still finding
 * suppliers and keeps running one that is not. What decides it now is whether
 * the last day produced anything, with a floor of a full day before that
 * question is even asked - a product whose keywords are unlucky deserves more
 * than an afternoon.
 *
 * Kept as the size of one batch of angles, which is when a fresh batch is
 * generated rather than when the search ends.
 */
export const ANGLES_PER_BATCH = MAX_GENERATED_ANGLES;

/** Retained for callers that still describe progress in rounds. */
export const MAX_DISCOVERY_RUNS = BROADENING_SUFFIXES.length + MAX_GENERATED_ANGLES + 1;

/** The search runs at least this long before "is it still working" is asked. */
export const MIN_HOURS_SEARCHING = 24;

/** And never longer than this, whatever it is finding. */
export const MAX_DAYS_SEARCHING = 14;

/**
 * Rounds a project may run in one day.
 *
 * Each round is a handful of searches, some page fetches and one scoring call.
 * Cheap individually, and unbounded across twelve cycles a day if nothing says
 * otherwise - so this is the cost ceiling, and productivity is the stop.
 */
export const MAX_ROUNDS_PER_DAY = 12;


/**
 * What to search on a given round.
 *
 * Round 0 is the operator's own keywords. The next twelve bolt a generic angle
 * onto them. After that the queries come from the product - generated once and
 * stored, because a factory names itself by material, process and standard, and
 * no fixed list of suffixes knows what those are for a given product.
 */
async function queriesForRound(
  project: typeof projects.$inferSelect,
  round: number,
  projectRequirements: string[],
): Promise<string[]> {
  if (round === 0) return project.keywords;

  if (round <= BROADENING_SUFFIXES.length) {
    return project.keywords.map((k) => `${k} ${BROADENING_SUFFIXES[round - 1]}`);
  }

  let angles = project.searchAngles ?? [];
  const index = round - BROADENING_SUFFIXES.length - 1;

  /*
   * Out of angles is not out of ideas.
   *
   * The list used to be generated once and the search ended when it ran out,
   * which made the stopping condition "we thought of fourteen things" rather
   * than "there is nothing more to find". A fresh batch is asked for with the
   * tried queries as exclusions, so it has to go somewhere genuinely new - a
   * different material, sub-assembly, cluster or national term.
   *
   * The model returning fewer than asked is a real answer, and the empty list
   * it eventually returns is what actually ends the search.
   */
  if (index >= angles.length) {
    const fresh = await generateAngles(
      project.name,
      project.keywords,
      projectRequirements,
      angles.map((a) => a.query),
    );

    if (fresh.length === 0) return [];

    angles = [...angles, ...fresh];
    await db.update(projects).set({ searchAngles: angles }).where(eq(projects.id, project.id));
    // Keep the in-memory copy in step so later rounds in this same call do not
    // regenerate and overwrite.
    project.searchAngles = angles;
  }

  const angle = angles[index];
  return angle ? [angle.query] : [];
}

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
 * Should this project keep looking, and why.
 *
 * A round cap answered this before, and a round cap is the wrong control: it
 * stops a search that is still producing suppliers and keeps running one that
 * is not. What matters is whether the last day found anything.
 *
 * The floor is a full day. A product whose obvious keywords happen to be
 * unlucky deserves more than an afternoon before anyone concludes its factories
 * do not exist, and a day of searching costs a few dollars.
 *
 * After that the test is productivity, which is the honest resource control:
 * the search stops when it stops working rather than when a counter says so.
 */
export interface SearchState {
  usable: number;
  target: number;
  roundsUsed: number;
  roundsToday: number;
  hoursSearching: number;
  /** Contactable leads found in the last day. Zero is the stopping signal. */
  usableFoundLast24h: number;
  shouldContinue: boolean;
  reasonHe: string;
}

export async function searchState(projectId: string): Promise<SearchState> {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  const usable = await usableLeadCount(projectId);

  const base: Omit<SearchState, "shouldContinue" | "reasonHe"> = {
    usable,
    target: TARGET_LEADS,
    roundsUsed: project?.discoveryRuns ?? 0,
    roundsToday: 0,
    hoursSearching: 0,
    usableFoundLast24h: 0,
  };

  if (!project) return { ...base, shouldContinue: false, reasonHe: "הפרויקט לא נמצא" };

  const hoursSearching = (Date.now() - project.createdAt.getTime()) / 3_600_000;
  const dayAgo = new Date(Date.now() - 24 * 3_600_000);

  const recent = await db
    .select({
      email: supplierLeads.email,
      status: supplierLeads.status,
      matchScore: supplierLeads.matchScore,
      createdAt: supplierLeads.createdAt,
    })
    .from(supplierLeads)
    .where(and(eq(supplierLeads.projectId, projectId), gte(supplierLeads.createdAt, dayAgo)));

  const usableFoundLast24h = recent.filter(
    (lead) =>
      (lead.email !== null || lead.status === "contacted") &&
      (lead.matchScore ?? 0) >= AUTO_APPROVE_SCORE &&
      lead.status !== "rejected",
  ).length;

  const roundsToday = project.discoveryRoundsToday ?? 0;
  const sameDay =
    project.discoveryDay !== null &&
    project.discoveryDay === new Date().toISOString().slice(0, 10);

  const state = {
    ...base,
    hoursSearching: Math.floor(hoursSearching),
    usableFoundLast24h,
    roundsToday: sameDay ? roundsToday : 0,
  };

  if (usable >= TARGET_LEADS) {
    return { ...state, shouldContinue: false, reasonHe: `הגיע ל-${usable} ספקים ברי-פנייה` };
  }

  if (state.roundsToday >= MAX_ROUNDS_PER_DAY) {
    return {
      ...state,
      shouldContinue: false,
      reasonHe: `מכסת החיפוש היומית מוצתה (${state.roundsToday}) · ממשיך מחר`,
    };
  }

  if (hoursSearching >= MAX_DAYS_SEARCHING * 24) {
    return {
      ...state,
      shouldContinue: false,
      reasonHe: `${MAX_DAYS_SEARCHING} ימים בחיפוש · נעצר עם ${usable} ספקים`,
    };
  }

  if (hoursSearching < MIN_HOURS_SEARCHING) {
    return {
      ...state,
      shouldContinue: true,
      reasonHe: `ביום הראשון של החיפוש - ממשיך בכל מקרה עד ${MIN_HOURS_SEARCHING} שעות`,
    };
  }

  if (usableFoundLast24h > 0) {
    return {
      ...state,
      shouldContinue: true,
      reasonHe: `${usableFoundLast24h} ספקים חדשים ביממה האחרונה - ממשיך כל עוד זה מניב`,
    };
  }

  return {
    ...state,
    shouldContinue: false,
    reasonHe: `יממה בלי ספק חדש · נעצר עם ${usable} מתוך ${TARGET_LEADS}. אפשר להוסיף ידנית לפי כתובת אתר`,
  };
}

/**
 * Leads that will actually become an outreach.
 *
 * The one definition of "how far along is this project", used by the search
 * loop, by the gate that decides whether to search at all, and by the page.
 * It existed inside the loop and nowhere else, so the gate outside counted raw
 * leads instead - and a project holding thirty-two leads of which nineteen had
 * an address and a passing score was judged finished. Soft Kettlebell stopped
 * searching eleven suppliers short of its target and nothing said so.
 *
 * A lead needs an address and a score above the approval bar. Anything looser
 * counts rows that will never be written to.
 */
export async function usableLeadCount(projectId: string): Promise<number> {
  const leads = await db
    .select({
      email: supplierLeads.email,
      status: supplierLeads.status,
      matchScore: supplierLeads.matchScore,
    })
    .from(supplierLeads)
    .where(eq(supplierLeads.projectId, projectId));

  return leads.filter(
    (lead) =>
      (lead.email !== null || lead.status === "contacted") &&
      (lead.matchScore ?? 0) >= AUTO_APPROVE_SCORE &&
      lead.status !== "rejected",
  ).length;
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
    .select({
      domain: supplierLeads.domain,
      email: supplierLeads.email,
      status: supplierLeads.status,
      matchScore: supplierLeads.matchScore,
    })
    .from(supplierLeads)
    .where(eq(supplierLeads.projectId, projectId));

  const seenDomains = new Set(already.map((r) => r.domain));

  /*
   * The target counts leads that will become an outreach, and nothing else.
   *
   * It counted raw candidate domains first, and stopped at 28 stored leads
   * because it saw thirty in hand - before scoring dropped the retailers and
   * enrichment failed on a third of the rest. Counting addresses instead was
   * closer but still wrong: LED WORKING LIGHT reached 34 contactable leads,
   * discovery declared the target met, and 25 emails went out. The other nine
   * had addresses and scores in the twenties - Wald, Hailo, WernerCo, American
   * brands rather than Chinese factories - so they were never going to be
   * written to.
   *
   * A lead that cannot be emailed, or that will not clear the approval bar, is
   * not one of the thirty. Counting anything looser means the search stops
   * while the number the operator actually watches is still short.
   */
  const usable = already.filter(
    (r) =>
      (r.email !== null || r.status === "contacted") &&
      (r.matchScore ?? 0) >= AUTO_APPROVE_SCORE &&
      r.status !== "rejected",
  ).length;

  const projectRequirements = (
    await db
      .select({ text: requirements.text })
      .from(requirements)
      .where(eq(requirements.projectId, projectId))
  ).map((r) => r.text);

  const hits: Awaited<ReturnType<typeof findCandidates>> = [];
  let roundsRun = 0;

  for (let i = 0; i < maxRounds; i++) {
    const round = startRound + i;
    if (usable + hits.length >= target) break;
    // The cycle has a budget and search is the most expensive thing in it.
    // Stopping between rounds costs nothing: the next call resumes here.
    if (options.deadline && Date.now() > options.deadline) break;

    const keywords = await queriesForRound(project, round, projectRequirements);
    if (keywords.length === 0) break;

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

  const scores = await scoreCandidates(project.name, projectRequirements, candidates);
  const scoreByDomain = new Map(scores.map((s) => [s.domain, s]));

  // Replace previous pending leads; approved and rejected decisions survive so
  // a re-run never resurrects something the operator already turned down.
  const existing = await db
    .select({ domain: supplierLeads.domain, status: supplierLeads.status })
    .from(supplierLeads)
    .where(eq(supplierLeads.projectId, projectId));
  const decided = new Set(existing.filter((e) => e.status !== "pending").map((e) => e.domain));

  /*
   * Counted in angles actually tried, not calls made. A call that stopped on
   * its deadline before searching must not burn an angle it never used.
   *
   * The daily counter resets by comparing the stored date, so nothing has to
   * run at midnight to clear it.
   */
  const today = new Date().toISOString().slice(0, 10);
  const sameDay = project.discoveryDay === today;

  await db
    .update(projects)
    .set({
      discoveryRuns: startRound + roundsRun,
      discoveryDay: today,
      discoveryRoundsToday: (sameDay ? (project.discoveryRoundsToday ?? 0) : 0) + roundsRun,
    })
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
