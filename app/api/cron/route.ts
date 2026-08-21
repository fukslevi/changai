import { NextResponse } from "next/server";
import { db, projects } from "@/lib/db";
import { runAutopilot, triageAndPark, withinSendingHours, withinSupplierHours } from "@/lib/inbox/autopilot";
import { runFollowUps } from "@/lib/inbox/followup";
import { runCampaign } from "@/lib/outreach/campaign";
import { markCycleRun } from "@/lib/settings";
import { pollInbox } from "@/lib/inbox/run";

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

function authorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  // Without a secret configured the route stays shut rather than open: an
  // unauthenticated endpoint here can send mail to suppliers.
  if (!secret) return false;

  const header = request.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!authorised(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Replies wait for their working day; first contact only waits for ours.
  const canReply = withinSupplierHours();
  const canContact = withinSendingHours();
  const summary: Record<string, unknown>[] = [];

  for (const project of await db.select().from(projects)) {
    try {
      const inbox = await pollInbox(project.id);
      const work = canReply
        ? await runAutopilot(project.id)
        : await triageAndPark(project.id);
      const chases = await runFollowUps(project.id, { send: canReply });

      // First contact goes out on the same schedule as everything else. A
      // project that is ready to write to suppliers and simply waits is not
      // autonomous, whatever the setting says.
      const campaign = await runCampaign(project.id);

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
