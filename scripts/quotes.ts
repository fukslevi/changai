/** Every recorded quote reading, refusals included. */
import { desc, eq } from "drizzle-orm";
import { db, projects, quoteReadings, suppliers } from "../lib/db";

async function main() {
  const needle = (process.argv[2] ?? "").toLowerCase();
  const all = await db.select().from(projects);
  const project = needle ? all.find((p) => p.name.toLowerCase().includes(needle)) : all[0];
  if (!project) process.exit(1);

  const rows = await db
    .select({
      company: suppliers.companyName, currency: quoteReadings.currency,
      incoterm: quoteReadings.incoterm, place: quoteReadings.incotermPlace,
      lines: quoteReadings.lines, moq: quoteReadings.moq, lead: quoteReadings.leadTimeDays,
      pay: quoteReadings.paymentTerms, carton: quoteReadings.cartonDimensionsCm,
      perCarton: quoteReadings.unitsPerCarton, deviations: quoteReadings.deviations,
      rejects: quoteReadings.rejectsTargetPrice, objection: quoteReadings.priceObjection,
      summary: quoteReadings.summaryHe, at: quoteReadings.createdAt,
    })
    .from(quoteReadings)
    .innerJoin(suppliers, eq(quoteReadings.supplierId, suppliers.id))
    .where(eq(quoteReadings.projectId, project.id))
    .orderBy(desc(quoteReadings.createdAt));

  console.log(`${project.name}: ${rows.length} readings\n`);
  for (const r of rows) {
    console.log("=".repeat(76));
    console.log(`${r.company}${r.rejects ? "   [דוחה את מחיר המטרה]" : ""}`);
    if (r.summary) console.log(`  ${r.summary}`);
    if (r.objection) console.log(`  התנגדות: ${r.objection}`);
    if (r.lines.length) {
      console.log(`  ${r.incoterm ?? "?"} ${r.place ?? ""} · MOQ ${r.moq ?? "-"} · ${r.lead ?? "-"} ימים · ${r.pay ?? "-"}`);
      for (const l of r.lines.slice(0, 8)) {
        console.log(`    ${String(l.qty ?? "-").padStart(5)}  $${l.unit_price ?? "?"}  ${l.item_name}${l.spec_note ? " — " + l.spec_note : ""}`);
      }
    }
    if (r.carton) console.log(`  קרטון: ${r.carton}, ${r.perCarton ?? "?"} יח'`);
    for (const d of r.deviations.slice(0, 4)) {
      console.log(`  ! ${d.our_requirement}  →  ${d.what_they_offer}${d.their_reason ? " (" + d.their_reason + ")" : ""}`);
    }
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
