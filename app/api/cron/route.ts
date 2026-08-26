import { NextResponse } from "next/server";
import { asc, eq, sql } from "drizzle-orm";
import { db, projects } from "@/lib/db";
import { runAutopilot, triageAndPark, withinSendingHours, withinSupplierHours } from "@/lib/inbox/autopilot";
import { runFollowUps } from "@/lib/inbox/followup";
import { runCampaign } from "@/lib/outreach/campaign";
import { markCycleRun } from "@/lib/settings";
import { pollInbox } from "@/lib/inbox/run";
import { authorised } from "./auth";

/**
 * One cycle of the agent, for a scheduler to call.
 *
 * The same three steps `npm run watch` runs on a laptop: read the mailbox,
 * triage what came back, and answer or chase where that is allowed. On a server
 * there is no process to leave running, so the schedule lives outside and this
 * route is the thing it pokes.
 *
 * Reading and triage run on every call. Sending only happens inside Chinese
 * business hours, so the queue is always current when someone opens the page
 * while nothing lands in a supplier's inbox at three in the morning.
 *
 * Announcements are not here. They live at /api/cron/notify, called straight
 * after this one, because when this route overran the alert was the first
 * thing dropped - and an alert that never arrives is the one failure that
 * makes an unwatched project unusable.
 *
 * Two schedules can drive this and they are deliberately unequal. Vercel's own
 * cron is capped at once a day on the Hobby plan, so it is set to 03:00 UTC -
 * late morning in China, the one daily slot where sending is allowed. The
 * GitHub Actions workflow runs every two hours for real responsiveness. Running
 * both is harmless: a second call in the same window finds nothing left to do,
 * because every step keys off what is already recorded.
 */

// Classifying several replies with a large model is not a fast request.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!authorised(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Replies wait for their working day; first contact only waits for ours.
  /*
   * A cycle that overruns is a cycle that reports failure having done real
   * work. Stop cleanly instead: whatever is left is picked up next time,
   * because every step reads its own state rather than a position in a loop.
   */
  const deadline = Date.now() + 170_000;

  const canReply = withinSupplierHours();
  const canContact = withinSendingHours();
  const summary: Record<string, unknown>[] = [];

  /*
   * Least recently cycled first.
   *
   * With a fixed order the deadline always falls on the same project - the one
   * that sorts last was skipped on every single run while the first two were
   * never skipped once. Rotating means a slow cycle costs every project a turn
   * occasionally instead of costing one project every turn.
   */
  const queue = await db
    .select()
    .from(projects)
    .orderBy(sql`${projects.lastCycledAt} asc nulls first`, asc(projects.createdAt));

  for (const project of queue) {
    // A project that is switched off is switched off: nothing read, nothing
    // sent, nothing chased. Anything less makes the switch a decoration.
    // Archiving always switches off, so this covers both - but they are
    // reported separately, because "I filed it away" and "I stopped it for
    // now" are different answers to "why is nothing happening".
    if (project.archivedAt) {
      summary.push({ project: project.name, skipped: "archived" });
      continue;
    }

    if (project.pausedAt) {
      summary.push({ project: project.name, skipped: "paused" });
      continue;
    }

    if (Date.now() > deadline) {
      summary.push({ project: project.name, skipped: "cycle out of time" });
      continue;
    }

    try {
      const inbox = await pollInbox(project.id);
      const work = canReply
        ? await runAutopilot(project.id)
        : await triageAndPark(project.id);
      const chases = await runFollowUps(project.id, { send: canReply });

      // First contact goes out on the same schedule as everything else. A
      // project that is ready to write to suppliers and simply waits is not
      // autonomous, whatever the setting says.
      /*
       * A campaign that throws must not take the project's whole cycle with
       * it. Ceiling Curtain Track threw "no saved email" on every run, and
       * because the throw escaped to the per-project catch, the inbox poll and
       * triage that had already succeeded were reported as one flat error - and
       * everything after the campaign, including the search, never ran.
       */
      let campaign: Awaited<ReturnType<typeof runCampaign>>;
      try {
        campaign = await runCampaign(project.id, { deadline });
      } catch (err) {
        campaign = {
          sent: [],
          failed: [],
          remaining: 0,
          skipped: `שגיאה בשליחה: ${err instanceof Error ? err.message : String(err)}`,
        };
      }

      // Stamped on the way out, so a project that threw still moves down the
      // queue - otherwise one broken project blocks the rotation permanently.
      await db
        .update(projects)
        .set({ lastCycledAt: new Date() })
        .where(eq(projects.id, project.id));

      summary.push({
        project: project.name,
        newMessages: inbox.newMessages,
        questionsRaised: inbox.parked,
        replied: work.replied.length,
        heldForHuman: work.heldForHuman.length,
        chased: chases.chased.length,
        closed: chases.closed.length,
        firstContacts: campaign.sent.length,
        stillToContact: campaign.remaining,
        campaignSkipped: campaign.skipped,
        errors: inbox.errors,
      });
    } catch (err) {
      await db
        .update(projects)
        .set({ lastCycledAt: new Date() })
        .where(eq(projects.id, project.id));

      summary.push({
        project: project.name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Stamped whatever happened: the useful fact is that the loop ran, not that
  // it found work.
  await markCycleRun();

  return NextResponse.json({ replyWindow: canReply, contactWindow: canContact, projects: summary });
}
