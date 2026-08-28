import { NextResponse } from "next/server";
import { asc, eq, sql } from "drizzle-orm";
import { db, projects } from "@/lib/db";
import { runAutopilot, triageAndPark, withinSendingHours, withinSupplierHours } from "@/lib/inbox/autopilot";
import { runFollowUps } from "@/lib/inbox/followup";
import { markCycleRun } from "@/lib/settings";
import { pollInbox } from "@/lib/inbox/run";
import { noteApiError } from "@/lib/health/credit";
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
 * Sending is not here either, and neither are the announcements. Both live on
 * their own routes - /api/cron/send and /api/cron/notify - because both were
 * starved when they sat at the end of this loop. Five projects each poll a
 * mailbox before the loop reaches the one with suppliers to write to, and a run
 * with permission to send nineteen sent two. Reading the mailbox two hours late
 * costs two hours; an allowance that expires unused does not come back.
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
  /*
   * Lower than it looks like it should be, because this is a gate on starting
   * a project rather than on finishing one. Whatever is already running when
   * the deadline passes still has to complete, and a single project's triage
   * can take a minute - so 140s of starting turns into roughly 200s of
   * running, which is the margin a 300s function needs.
   *
   * The cycle overran and returned nothing at all when this was 170s with five
   * projects, and a run that dies at the timeout reports no work rather than
   * partial work.
   */
  const deadline = Date.now() + 140_000;

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

      /*
       * The deadline goes into the triage rather than only around it.
       *
       * Checking it between projects bounds how many projects start, not how
       * long one takes, and one project with a dozen unread replies is a dozen
       * model calls. That is what pushed this route past 300s twice on 28.08:
       * curl got nothing back, the run was recorded as a failure, and the
       * mailbox went unread for most of a day while sending - a separate step
       * with `if: always()` - carried on and hid it.
       */
      const work = canReply
        ? await runAutopilot(project.id, { deadline })
        : await triageAndPark(project.id, { deadline });

      /*
       * Chases are skipped once the clock is out, not squeezed in. A chase is
       * by definition not urgent - it exists because nobody replied - and the
       * rotation is by lastCycledAt, so the project that loses its chase this
       * run sorts first on the next one.
       */
      const chases =
        Date.now() > deadline
          ? { chased: [], closed: [] }
          : await runFollowUps(project.id, { send: canReply });

      /*
       * Stamped on the way out, so a project that threw still moves down the
       * queue - otherwise one broken project blocks the rotation permanently.
       */
      await db
        .update(projects)
        .set({ lastCycledAt: new Date() })
        .where(eq(projects.id, project.id));

      /*
       * An empty API balance surfaces here first, as a string inside this
       * array, and a string inside an array is not a warning anyone sees. It
       * is recorded so the front page can be red about it.
       */
      for (const message of inbox.errors) await noteApiError(message);

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
      await noteApiError(err);

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
