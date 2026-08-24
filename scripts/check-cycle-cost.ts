/**
 * What one project costs a cycle, so "how many can run at once" has an answer.
 *
 * The concurrency ceiling I proposed was two, and two was a guess. The real
 * constraint is that the scheduled cycle has 300 seconds and must get through
 * every active project inside them - so the ceiling is the budget divided by
 * what a project costs, and nobody had measured the divisor.
 *
 * Times the read side only: polling, triage, follow-up planning. Nothing is
 * sent and nothing is searched, because those are the parts already bounded by
 * their own budgets. This measures the floor - what a project costs just by
 * being active on a quiet day.
 */
import { asc, eq } from "drizzle-orm";
import { db, messages, projects } from "../lib/db";
import { silentThreads } from "../lib/inbox/followup";
import { pollInbox } from "../lib/inbox/run";
import { triageAndPark } from "../lib/inbox/autopilot";

async function time<T>(label: string, fn: () => Promise<T>): Promise<[T, number]> {
  const start = Date.now();
  const value = await fn();
  const ms = Date.now() - start;
  console.log(`    ${label.padEnd(18)} ${(ms / 1000).toFixed(1)}s`);
  return [value, ms];
}

async function main() {
  const rows = await db.select().from(projects).orderBy(asc(projects.createdAt));
  let totalMs = 0;
  let activeProjects = 0;

  for (const project of rows) {
    if (project.pausedAt || project.archivedAt) {
      console.log(`\n${project.name}: off, costs nothing`);
      continue;
    }

    const threads = await db
      .select({ supplierId: messages.supplierId })
      .from(messages)
      .where(eq(messages.projectId, project.id));
    const liveThreads = new Set(threads.map((t) => t.supplierId)).size;

    console.log(`\n${project.name}  (${liveThreads} threads)`);

    const start = Date.now();
    await time("pollInbox", () => pollInbox(project.id));
    await time("triage", () => triageAndPark(project.id));
    await time("followup plan", () => silentThreads(project.id));
    const ms = Date.now() - start;

    console.log(`    ${"total".padEnd(18)} ${(ms / 1000).toFixed(1)}s  for ${liveThreads} threads`);
    totalMs += ms;
    activeProjects++;
  }

  if (activeProjects === 0) {
    console.log("\nno active projects");
    process.exit(0);
  }

  const avgSeconds = totalMs / activeProjects / 1000;
  console.log(`\n=== ${activeProjects} active projects, ${(totalMs / 1000).toFixed(1)}s total ===`);
  console.log(`average per project (quiet, read side only): ${avgSeconds.toFixed(1)}s`);

  // The cycle also spends time searching and sending, which are budgeted
  // separately - 70s and whatever is left. What is left over for the read side
  // is the number that decides how many projects fit.
  for (const budget of [170, 240, 280]) {
    console.log(`  fits in ${budget}s of read time: ${Math.floor(budget / avgSeconds)} projects`);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
