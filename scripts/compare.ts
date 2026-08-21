/** The comparison table, from the terminal. */
import { db, projects } from "../lib/db";
import { buildComparison } from "../lib/quotes/compare";

async function main() {
  const needle = (process.argv[2] ?? "").toLowerCase();
  const all = await db.select().from(projects);
  const project = needle ? all.find((p) => p.name.toLowerCase().includes(needle)) : all[0];
  if (!project) process.exit(1);

  const c = await buildComparison(project.id);
  console.log(`${project.name}: ${c.suppliers.length} suppliers · ${c.refusals} refused the target\n`);
  if (c.walkAwayByQty) {
    console.log("walk-away: " + [...c.walkAwayByQty].map(([q, v]) => `${q}=$${v.toFixed(2)}`).join("  "));
  }
  console.log();

  for (const s of c.suppliers) {
    console.log("=".repeat(72));
    console.log(`${s.company}${s.rejectsTargetPrice ? "   [דוחה]" : ""}`);
    if (s.incoterm || s.moq || s.leadTimeDays) {
      console.log(`  ${s.incoterm ?? "?"} · MOQ ${s.moq ?? "-"} · ${s.leadTimeDays ?? "-"} ימים · ${s.paymentTerms ?? "-"}`);
    }
    if (s.cartonDimensionsCm) console.log(`  קרטון ${s.cartonDimensionsCm} · ${s.unitsPerCarton ?? "?"} יח'`);
    for (const l of s.lines.slice(0, 6)) {
      const verdict = l.passes === null ? "" : l.passes ? "  ✓" : "  ✗";
      console.log(
        `    ${String(l.qty ?? "-").padStart(5)}  FOB $${(l.quotedFob ?? 0).toFixed(2).padStart(6)}` +
        `  נחיתה $${l.landed === null ? "  ?  " : l.landed.toFixed(2).padStart(6)}` +
        `  תקרה $${l.walkAway === null ? "  ?  " : l.walkAway.toFixed(2).padStart(6)}` +
        `  מרווח ${l.headroom === null ? "?" : (l.headroom >= 0 ? "+" : "") + l.headroom.toFixed(2)}${verdict}  ${l.itemName.slice(0, 30)}`,
      );
    }
    if (s.priceObjection) console.log(`  "${s.priceObjection.slice(0, 120)}"`);
    if (s.deviations.length) console.log(`  ${s.deviations.length} סטיות מהמפרט`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
