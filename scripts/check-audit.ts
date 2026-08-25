/**
 * Run the target-price audit against a real project.
 *
 * usage: check-audit <project> <retail> [roi] [fbaFee] [freight] [referral] [ppc] [duty]
 */
import { db, projects } from "../lib/db";
import { auditTarget, type AuditInput } from "../lib/pricing/audit";

function money(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "-" : `$${value.toFixed(2)}`;
}

function pct(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "-" : `${(value * 100).toFixed(0)}%`;
}

async function main() {
  const [name, retail, roi, fba, freight, referral, ppc, duty] = process.argv.slice(2);
  if (!name || !retail) {
    console.log("usage: check-audit <project> <retail> [roi] [fbaFee] [freight] [referral] [ppc] [duty]");
    process.exit(1);
  }

  const all = await db.select().from(projects);
  const project = all.find((p) => p.name.toLowerCase().includes(name.toLowerCase()));
  if (!project) {
    console.log(`no project matching "${name}"`);
    process.exit(1);
  }

  const input: AuditInput = {
    retailUsd: Number(retail),
    targetRoi: Number(roi ?? 1),
    fbaFeeUsd: Number(fba ?? 0),
    freightUsdPerUnit: Number(freight ?? 0),
    referralPct: Number(referral ?? 15),
    ppcPct: Number(ppc ?? 10),
    dutyRatePct: Number(duty ?? 0),
  };

  console.log(`${project.name}\n`);
  console.log(`  retail ${money(input.retailUsd)} · commission ${input.referralPct}% · ads ${input.ppcPct}%`);
  console.log(`  fulfilment ${money(input.fbaFeeUsd)} · freight ${money(input.freightUsdPerUnit)} · duty ${input.dutyRatePct}%`);
  console.log(`  required ROI ${pct(input.targetRoi)}\n`);

  const result = await auditTarget(project.id, project.name, input);

  console.log(`  net revenue after fees:      ${money(result.netRevenue)}`);
  console.log(`  max landed at that ROI:      ${money(result.maxLanded)}`);
  console.log(`  max factory price:           ${money(result.walkAwayFob)}`);
  console.log(`  RFQ target:                  ${money(result.rfqTarget)}`);
  console.log(`  factories refusing target:   ${result.refusals}\n`);

  if (result.best) {
    console.log(`  cheapest real quote:         ${money(result.best.fob)} (${result.best.company})`);
    console.log(`  landed at that price:        ${money(result.landedAtBest)}`);
    console.log(`  ROI at that price:           ${pct(result.roiAtBest)}`);
    console.log(`  retail needed for target:    ${money(result.retailForTargetRoi)}\n`);
  } else {
    console.log("  no supplier has quoted yet\n");
  }

  console.log("  all quotes:");
  for (const quote of result.quotes) {
    console.log(`    ${money(quote.fob)}  ${quote.company}`);
  }

  console.log(`\n  verdict:\n    ${result.verdictHe?.replace(/\n/g, "\n    ")}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
