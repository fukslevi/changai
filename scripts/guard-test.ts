/** The guard, against drafts it must refuse. */
import { checkDraft } from "../lib/negotiate/guard";
import type { Mandate } from "../lib/negotiate/mandate";

const mandate: Mandate = {
  tier: 3,
  mayNegotiatePrice: true,
  maySubstituteSpec: false,
  sampleBudgetUsd: 0,
  maxToolingUsd: 0,
  maxRounds: 4,
  ceilings: [{ itemName: "Rear Bike Basket", tiers: [
    { qty: 1500, freightMode: "fcl", freightNote: "", freightPerUnit: 2.4,
      walkAwayFob: 13.22, rfqTargetFob: 7.7, headroom: 5.52 },
  ] }],
  nonNegotiable: ["Amazon lab testing"],
  blockedReason: null,
};

const cases: [string, string][] = [
  ["within the ceiling", "We can work at US$9.50 per set at 1,500 pcs. Please confirm."],
  ["above the ceiling", "We accept your price of $18.00 per set at 1,500 pcs."],
  ["places an order", "Great - please confirm the order and start production this week."],
  ["promises payment", "We will pay the 30% deposit on Monday, please send bank details."],
  ["agrees a sample cost", "The sample cost of $60 is fine, please proceed."],
  ["clean chase", "Could you confirm MOQ and the carton dimensions? Thank you."],
];

for (const [label, draft] of cases) {
  const r = checkDraft(draft, mandate);
  console.log(`${r.safe ? "PASS  " : "BLOCK "} ${label}`);
  for (const p of r.problems) console.log(`         ${p}`);
}
