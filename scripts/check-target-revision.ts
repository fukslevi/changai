/**
 * Change a target, see what it moves, then put it back.
 *
 * The claims worth testing are the ones with reach: that the negotiation
 * ceiling follows the target without anyone touching the autonomy settings, and
 * that raising the target surfaces exactly the suppliers who refused the old
 * one. Both are invisible from the form itself.
 *
 * Restores in a finally block, revision rows included - a check that leaves a
 * live project negotiating against a made-up number is worse than no check.
 */
import { and, eq } from "drizzle-orm";
import { db, items, projects, targetRevisions } from "../lib/db";
import { loadMandate } from "../lib/negotiate/mandate";
import { directionOf, reviseTarget, suppliersAffectedBy } from "../lib/pricing/revise";

async function ceilings(projectId: string): Promise<string> {
  const mandate = await loadMandate(projectId);
  return mandate.ceilings
    .flatMap((c) => c.tiers.map((t) => `${t.qty}: target $${t.target} ceiling $${t.ceiling.toFixed(2)}`))
    .join("  |  ");
}

async function main() {
  const name = process.argv[2] ?? "Rear Bike";
  const all = await db.select().from(projects);
  const project = all.find((p) => p.name.toLowerCase().includes(name.toLowerCase()));
  if (!project) {
    console.log(`no project matching "${name}"`);
    process.exit(1);
  }

  const priced = (
    await db.select().from(items).where(eq(items.projectId, project.id))
  ).filter((i) => i.kind === "priced_variant" && i.targetPrices.length > 0);

  const item = priced[0];
  if (!item) {
    console.log(`${project.name}: no priced item with a target`);
    process.exit(0);
  }

  const originalTargets = item.targetPrices;
  const current = originalTargets.find((p) => p.unit_price !== null)?.unit_price ?? 0;
  const raised = Math.round(current * 1.25 * 100) / 100;

  console.log(`${project.name} · ${item.name}`);
  console.log(`  targets now: ${JSON.stringify(originalTargets.map((p) => [p.qty, p.unit_price]))}`);
  console.log(`  ceilings now: ${await ceilings(project.id)}`);

  try {
    console.log(`\nraising every tier to $${raised.toFixed(2)}`);
    const change = await reviseTarget({
      projectId: project.id,
      itemId: item.id,
      qty: null,
      newUsd: raised,
      reasonHe: "בדיקה אוטומטית",
    });

    console.log(`  direction: ${directionOf(change.previous, change.next)}`);
    console.log(`  ceilings after: ${await ceilings(project.id)}   <- must have moved`);

    const affected = await suppliersAffectedBy(project.id, change);
    console.log(`\n  ${affected.length} suppliers affected:`);
    for (const supplier of affected) {
      console.log(`    ${supplier.company}${supplier.refusedOldTarget ? "  [refused the old target]" : ""}`);
      console.log(`      ${supplier.whyHe}`);
    }
  } finally {
    await db.update(items).set({ targetPrices: originalTargets }).where(eq(items.id, item.id));
    await db
      .delete(targetRevisions)
      .where(
        and(eq(targetRevisions.projectId, project.id), eq(targetRevisions.reasonHe, "בדיקה אוטומטית")),
      );
    console.log(`\nrestored`);
    console.log(`  ceilings: ${await ceilings(project.id)}`);
    const left = await db
      .select()
      .from(targetRevisions)
      .where(eq(targetRevisions.projectId, project.id));
    console.log(`  revision rows left behind: ${left.length}`);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
