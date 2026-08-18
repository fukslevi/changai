/** The walk-away price per product and quantity tier. */
import { db, projects } from "../lib/db";
import { projectPricing } from "../lib/pricing/project";

async function main() {
  const all = await db.select().from(projects);
  const project = all[0];
  if (!project) { console.error("No project"); process.exit(1); }

  const pricing = await projectPricing(project.id);
  console.log(`${project.name}\n`);
  console.log(`ROI target ${pricing.commercial.targetRoi} · duty ${pricing.commercial.dutyRatePct}% · referral ${pricing.commercial.referralPct}% · ppc ${pricing.commercial.ppcPct}%\n`);

  for (const p of pricing.products) {
    console.log("=".repeat(74));
    console.log(`${p.name}   retail $${p.product.targetRetailUsd} · FBA $${p.product.fbaFeeUsd} · ${p.product.cbmPerUnit} CBM/unit`);
    if (!p.verdict) { console.log(`  missing: ${p.readiness.missing.join(", ")}`); continue; }
    console.log(`  net revenue $${p.verdict.netRevenue.toFixed(2)} · max landed $${p.verdict.maxLanded.toFixed(2)}\n`);
    console.log("   qty   mode  freight/unit   walk-away   RFQ target   headroom");
    for (const t of p.tiers) {
      const target = t.rfqTargetFob === null ? "     -" : `$${t.rfqTargetFob.toFixed(2)}`;
      const head = t.headroom === null ? "     -" : `${t.headroom >= 0 ? "+" : ""}$${t.headroom.toFixed(2)}`;
      console.log(
        `  ${String(t.qty).padStart(5)}   ${t.freightMode.toUpperCase()}   ` +
        `$${t.freightPerUnit.toFixed(2).padStart(6)}      $${t.walkAwayFob.toFixed(2).padStart(6)}      ${target.padStart(7)}    ${head.padStart(8)}   ${t.freightNote}`,
      );
    }
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
