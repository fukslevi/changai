import { NextResponse } from "next/server";
import { db, projects } from "@/lib/db";
import { runAutopilot, triageAndPark, withinSupplierHours } from "@/lib/inbox/autopilot";
import { runFollowUps } from "@/lib/inbox/followup";
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

  const canSend = withinSupplierHours();
  const summary: Record<string, unknown>[] = [];

  for (const project of await db.select().from(projects)) {
    try {
      const inbox = await pollInbox(project.id);
      const work = canSend
        ? await runAutopilot(project.id)
        : await triageAndPark(project.id);
      const chases = await runFollowUps(project.id, { send: canSend });

      summary.push({
        project: project.name,
        newMessages: inbox.newMessages,
        questionsRaised: inbox.parked,
        replied: work.replied.length,
        heldForHuman: work.heldForHuman.length,
        chased: chases.chased.length,
        closed: chases.closed.length,
        errors: inbox.errors,
      });
    } catch (err) {
      summary.push({
        project: project.name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({ sendingWindow: canSend, projects: summary });
}
