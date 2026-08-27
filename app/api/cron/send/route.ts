import { NextResponse } from "next/server";
import { and, asc, isNull } from "drizzle-orm";
import { db, projects } from "@/lib/db";
import { runCampaign } from "@/lib/outreach/campaign";
import { authorised } from "../auth";

/**
 * Sending, on its own budget.
 *
 * It ran inside the main cycle and was starved there. Five projects each poll
 * the mailbox and triage what came back before the loop reaches the one with
 * suppliers to write to, and the cycle's budget is shared - so a run that had
 * permission to send nineteen sent two, and the day's allowance went unspent
 * while the page said everything was fine.
 *
 * The pattern is the same one the announcements needed: work that is cheap,
 * global and must not be dropped does not belong at the end of an expensive
 * loop. Reading the mailbox two hours late costs two hours. An allowance that
 * expires unused does not come back.
 *
 * Projects are taken oldest first, which is what makes the day drain one
 * project at a time - the front takes what it needs and only the remainder
 * reaches the next.
 */
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!authorised(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const deadline = Date.now() + 260_000;
  const summary: Record<string, unknown>[] = [];

  const queue = await db
    .select()
    .from(projects)
    .where(and(isNull(projects.pausedAt), isNull(projects.archivedAt)))
    .orderBy(asc(projects.createdAt));

  for (const project of queue) {
    if (Date.now() > deadline) {
      summary.push({ project: project.name, skipped: "out of time" });
      continue;
    }

    try {
      const run = await runCampaign(project.id, { deadline });
      summary.push({
        project: project.name,
        sent: run.sent.length,
        failed: run.failed.length,
        remaining: run.remaining,
        skipped: run.skipped,
      });
    } catch (err) {
      summary.push({
        project: project.name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({ projects: summary });
}
