/**
 * Does the day's thirty actually get filled from more than one project?
 *
 * The rule is thirty cold emails a day, taken from the front of the queue - so
 * a project with nineteen suppliers must send its nineteen and hand the
 * remaining eleven to the next project the same day. The previous rule
 * guaranteed the ceiling and quietly lost the floor, so this is the claim worth
 * checking.
 *
 * Read-only: it walks the queue arithmetic without sending anything.
 */
import { asc, eq } from "drizzle-orm";
import { db, projects } from "../lib/db";
import { campaignStatus } from "../lib/outreach/batch";
import { coldSentToday, maxColdPerDay } from "../lib/outreach/slot";

async function main() {
  const cap = await maxColdPerDay();
  const already = await coldSentToday();
  let budget = cap - already;

  console.log(`daily cap ${cap} · already sent today ${already} · ${budget} left\n`);

  const live = (await db.select().from(projects).orderBy(asc(projects.createdAt))).filter(
    (p) => !p.pausedAt && !p.archivedAt,
  );

  for (const project of live) {
    const status = await campaignStatus(project.id);
    if (status.pending.length === 0) {
      console.log(`  ${project.name}: nothing pending`);
      continue;
    }
    if (budget <= 0) {
      console.log(`  ${project.name}: ${status.pending.length} waiting - budget spent, tomorrow`);
      continue;
    }
    const takes = Math.min(budget, status.pending.length);
    budget -= takes;
    console.log(
      `  ${project.name}: sends ${takes} of ${status.pending.length}` +
        (takes < status.pending.length ? ` (${status.pending.length - takes} tomorrow)` : "") +
        ` · ${budget} left for the rest`,
    );
  }

  console.log(`\ntotal that would go out today: ${cap - already - budget}`);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
