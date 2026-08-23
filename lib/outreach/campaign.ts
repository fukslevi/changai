/**
 * Run the outbound campaign unattended, on an autonomous project.
 *
 * The interactive path paces itself from the browser, which is fine while
 * someone is watching and useless on a schedule. Here the pace comes from the
 * cycle itself: a handful per run, spaced out, and the next run picks up where
 * this one stopped. Nothing is lost by stopping early - the pending list is
 * derived from what has already been recorded.
 */
import { eq } from "drizzle-orm";
import { db, projects, supplierLeads } from "../db";
import { MAX_DISCOVERY_RUNS, runDiscovery, TARGET_LEADS } from "../discovery/run";
import { approveAllAbove } from "../actions/discovery";
import { campaignStatus, prepareCampaign, sendNext } from "./batch";

/**
 * Enough to make progress every couple of hours, few enough that a mistake is
 * caught before it reaches a whole shortlist. Eight suppliers take three runs.
 */
const MAX_PER_RUN = 3;

/** Seconds between sends inside one run. */
function pauseMs(): number {
  return 25_000 + Math.floor(Math.random() * 20_000);
}

export interface CampaignRun {
  sent: string[];
  failed: { company: string; error: string }[];
  remaining: number;
  skipped: string | null;
}

export async function runCampaign(projectId: string): Promise<CampaignRun> {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) return { sent: [], failed: [], remaining: 0, skipped: "no project" };

  if (project.autonomyTier < 3) {
    return { sent: [], failed: [], remaining: 0, skipped: "not autonomous" };
  }

  /*
   * Top the shortlist up before sending. A first pass that returned nine leads
   * is not a finished search - it is one angle - and the code that broadens it
   * existed but nothing ever called it again, so the target was never reached
   * on any project that already had leads.
   */
  const leadCount = (
    await db.select({ id: supplierLeads.id }).from(supplierLeads).where(eq(supplierLeads.projectId, projectId))
  ).length;

  if (leadCount < TARGET_LEADS && (project.discoveryRuns ?? 0) < MAX_DISCOVERY_RUNS) {
    // One broadening round per cycle. The cycle has a time budget and discovery
    // is the most expensive thing in it.
    await runDiscovery(projectId, { maxRounds: 1 });
    const data = new FormData();
    data.set("projectId", projectId);
    data.set("threshold", "30");
    await approveAllAbove({}, data);
  }

  const status = await campaignStatus(projectId);
  if (status.pending.length === 0) {
    return { sent: [], failed: [], remaining: 0, skipped: null };
  }

  // Fails loudly here rather than half way through a list: a missing walk-away
  // or an unset mailbox should stop the run, not produce three sends and a
  // crash on the fourth.
  const prepared = await prepareCampaign(projectId);

  const run: CampaignRun = { sent: [], failed: [], remaining: status.pending.length, skipped: null };

  for (let i = 0; i < MAX_PER_RUN; i++) {
    const outcome = await sendNext(projectId, prepared);
    if (!outcome) break;

    if (outcome.ok) run.sent.push(outcome.recipient.companyName);
    else run.failed.push({ company: outcome.recipient.companyName, error: outcome.error ?? "" });

    run.remaining = outcome.remaining;
    if (outcome.remaining === 0) break;
    if (i < MAX_PER_RUN - 1) await new Promise((r) => setTimeout(r, pauseMs()));
  }

  return run;
}
