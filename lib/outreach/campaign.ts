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
import { MAX_DISCOVERY_RUNS, reenrichMissing, runDiscovery, TARGET_LEADS } from "../discovery/run";
import { approveAllAbove } from "../actions/discovery";
import { campaignStatus, prepareCampaign, sendNext } from "./batch";

/**
 * Enough to make progress every couple of hours, few enough that a mistake is
 * caught before it reaches a whole shortlist. Three was too cautious once the
 * target became thirty: at three every two hours a full shortlist takes most
 * of a day to write to, and the pacing that matters to a supplier is the gap
 * between messages, not how many other factories heard from us today.
 */
const MAX_PER_RUN = 6;

/** How long one cycle may spend searching before it moves on. */
const DISCOVERY_BUDGET_MS = 70_000;

/**
 * Seconds between sends inside one run.
 *
 * It was 25-45s, which at six sends is nearly four minutes of a cycle that has
 * under three - the pause alone would decide how many suppliers got written to.
 * The gap is there so a shortlist does not arrive as one visible blast, and
 * eight to twenty seconds does that: these are separate emails to separate
 * companies, and a person working through a sourcing list sends them about
 * this fast.
 */
function pauseMs(): number {
  return 8_000 + Math.floor(Math.random() * 12_000);
}

export interface CampaignRun {
  sent: string[];
  failed: { company: string; error: string }[];
  remaining: number;
  skipped: string | null;
}

export async function runCampaign(
  projectId: string,
  options: { deadline?: number } = {},
): Promise<CampaignRun> {
  const deadline = options.deadline ?? Date.now() + 150_000;
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
    /*
     * Several angles per cycle now, bounded by a clock rather than a count.
     * One round every two hours means a dozen angles take a day and a half to
     * try, which is not what "find me thirty suppliers" means to anyone. The
     * deadline is what keeps it from starving the rest of the cycle, and a
     * round that does not fit simply happens next time.
     */
    await runDiscovery(projectId, {
      maxRounds: 4,
      // Never more than half of what is left, so searching cannot eat the
      // sending it is supposed to be feeding.
      deadline: Math.min(Date.now() + DISCOVERY_BUDGET_MS, Date.now() + (deadline - Date.now()) / 2),
    });
  }

  /*
   * Then give the addressless leads another go, before approving. A lead with
   * no email cannot be approved, so the order matters: enrich, then approve,
   * then send.
   */
  if (Date.now() < deadline - 20_000) {
    await reenrichMissing(projectId, { limit: 8, deadline: deadline - 15_000 });
  }

  /*
   * Approving is outside the discovery gate, and that is the whole point.
   *
   * It used to sit inside, so once a project ran out of discovery rounds it
   * also stopped approving - LED WORKING LIGHT had four leads with addresses
   * and good scores sitting pending forever, while the page said five
   * suppliers had been contacted. Nothing was searching and nothing was
   * approving, and the two failures looked like one.
   */
  const data = new FormData();
  data.set("projectId", projectId);
  data.set("threshold", "30");
  await approveAllAbove({}, data);

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
    if (Date.now() > deadline) break;

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
