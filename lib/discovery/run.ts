import { eq, sql } from "drizzle-orm";
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
 * keywords -> search -> company site -> email -> score -> pending leads.
 *
 * Nothing here contacts anyone. Every lead lands as `pending` for the operator
 * to approve or reject; that gate is the whole point of the flow.
 */
export async function runDiscovery(projectId: string): Promise<DiscoveryResult> {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) throw new Error("Project not found");
  if (project.keywords.length === 0) throw new Error("Add keywords before running discovery");

  const hits = await findCandidates(project.keywords);

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
