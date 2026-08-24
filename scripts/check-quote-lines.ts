/** Every priced line we hold, so "best gap" can be judged against reality. */
import { desc, eq } from "drizzle-orm";
import { db, items, projects, quoteReadings, suppliers } from "../lib/db";

async function main() {
  const name = process.argv[2] ?? "Rear Bike";
  const all = await db.select().from(projects);
  const project = all.find((p) => p.name.toLowerCase().includes(name.toLowerCase()));
  if (!project) {
    console.log(`no project matching "${name}"`);
    process.exit(1);
  }

  const priced = (await db.select().from(items).where(eq(items.projectId, project.id))).filter(
    (i) => i.kind === "priced_variant",
  );

  console.log(`${project.name}\n\ntargets:`);
  for (const item of priced) {
    console.log(`  ${item.name}`);
    for (const point of item.targetPrices) {
      console.log(`    qty ${point.qty} -> $${point.unit_price}`);
    }
  }

  const readings = await db
    .select({
      company: suppliers.companyName,
      lines: quoteReadings.lines,
      createdAt: quoteReadings.createdAt,
    })
    .from(quoteReadings)
    .innerJoin(suppliers, eq(quoteReadings.supplierId, suppliers.id))
    .where(eq(quoteReadings.projectId, project.id))
    .orderBy(desc(quoteReadings.createdAt));

  console.log(`\nquote lines:`);
  for (const reading of readings) {
    const withPrice = reading.lines.filter((l) => l.unit_price !== null);
    if (withPrice.length === 0) continue;
    console.log(`\n  ${reading.company}  (${reading.createdAt.toISOString().slice(0, 10)})`);
    for (const line of withPrice) {
      console.log(`    qty ${String(line.qty ?? "-").padEnd(6)} $${String(line.unit_price).padEnd(8)} ${line.item_name}`);
    }
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
