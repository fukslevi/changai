/**
 * Fill in the commercial model from the terminal.
 *
 *   npx tsx --env-file=.env scripts/set-commercials.ts
 *
 * Same values the Commercial model panel writes; here so the numbers can be
 * checked against the walk-away in one run.
 */
import { eq } from "drizzle-orm";
import { db, items, projects } from "../lib/db";

async function main() {
  const all = await db.select().from(projects);
  const project = all[0];
  if (!project) { console.error("No project"); process.exit(1); }

  await db
    .update(projects)
    .set({
      targetRoi: "1",
      ppcPct: "10",
      roiAfterPpc: true,
      referralPct: "15",
      dutyRatePct: "0",
      inboundUsdPerUnit: "0.5",
    })
    .where(eq(projects.id, project.id));

  const rows = await db.select().from(items).where(eq(items.projectId, project.id));
  for (const item of rows) {
    if (item.kind !== "priced_variant") continue;
    // Only the main basket has a stated retail price. The folding variant is
    // left empty on purpose: an invented number would read as a decision.
    const retail = /folding/i.test(item.name) ? null : "55";
    await db
      .update(items)
      .set({ targetRetailUsd: retail, fbaFeeUsd: "9", assumedCbmPerUnit: "0.025" })
      .where(eq(items.id, item.id));
    console.log(`${item.name}: retail ${retail ? "$" + retail : "(not set)"}`);
  }

  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
