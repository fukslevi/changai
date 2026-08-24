/**
 * Give back the discovery rounds that were never actually used.
 *
 * Every scheduled top-up re-ran round 0 - the operator's own keywords - because
 * the round index was a loop counter that restarted on each call. So a project
 * showing four rounds used has tried exactly one angle, and leaving the counter
 * where it is would retire a search that never happened.
 *
 * Set to 1: round 0 genuinely ran, the twelve broadening angles did not.
 */
import { gt, sql } from "drizzle-orm";
import { db, projects } from "../lib/db";

async function main() {
  const before = await db.select().from(projects);
  for (const project of before) {
    console.log(`${project.name}: discoveryRuns ${project.discoveryRuns}`);
  }

  await db
    .update(projects)
    .set({ discoveryRuns: 1 })
    .where(gt(projects.discoveryRuns, 1));

  const after = await db.select().from(projects);
  console.log("");
  for (const project of after) {
    console.log(`${project.name}: discoveryRuns ${project.discoveryRuns}`);
  }

  await db.execute(sql`select 1`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
