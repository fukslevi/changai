/**
 * Sanity-check the landed-cost model against a worked example.
 *
 *   npx tsx --env-file=.env scripts/pricing-check.ts
 *
 * The numbers here are the ones quoted in the chat, so a change in the model
 * that silently moves the walk-away shows up as a failing line rather than as a
 * different answer nobody noticed.
 */
import { evaluate, landedCost } from "../lib/pricing/landed";

const commercial = {
  targetRoi: 1,
  ppcPct: 10,
  roiAfterPpc: true,
  referralPct: 15,
  dutyRatePct: 28.7,
  freightUsdPerCbm: 200,
  inboundUsdPerUnit: 0.5,
};

const product = { targetRetailUsd: 45, fbaFeeUsd: 9, cbmPerUnit: 0.025 };

const breakdown = landedCost(7.7, commercial, product.cbmPerUnit);
console.log("landed cost at the RFQ target price of $7.70");
console.log(`  fob     ${breakdown.fob.toFixed(2)}`);
console.log(`  freight ${breakdown.freight.toFixed(2)}`);
console.log(`  duty    ${breakdown.duty.toFixed(2)}`);
console.log(`  inbound ${breakdown.inbound.toFixed(2)}`);
console.log(`  landed  ${breakdown.landed.toFixed(2)}\n`);

const verdict = evaluate(commercial, product, 7.7);
console.log(`retail            $${product.targetRetailUsd.toFixed(2)}`);
console.log(`net revenue       $${verdict.netRevenue.toFixed(2)}`);
console.log(`max landed        $${verdict.maxLanded.toFixed(2)}`);
console.log(`walk-away FOB     $${verdict.walkAwayFob.toFixed(2)}`);
console.log(`ROI at $7.70      ${(verdict.roi! * 100).toFixed(0)}%`);
console.log(`passes 100% rule  ${verdict.passes ? "yes" : "no"}`);
console.log(`headroom vs $7.70 $${verdict.headroomFob!.toFixed(2)}\n`);

// What retail price would make the RFQ target price work?
for (const retail of [45, 50, 55, 60]) {
  const v = evaluate(commercial, { ...product, targetRetailUsd: retail });
  console.log(`retail $${retail}  ->  walk-away FOB $${v.walkAwayFob.toFixed(2)}`);
}
