/**
 * What the agent is allowed to agree to, and where it must stop.
 *
 * Almost all of this is derived rather than typed in. The walk-away comes from
 * the landed-cost model, the opening price from the RFQ, the mandatory
 * requirements from the parsed document. What the operator actually decides is
 * three numbers: how far autonomy goes, what may be spent on samples, and what
 * may be spent on tooling.
 *
 * The limits below are not caution for its own sake. A negotiating agent with
 * no ceiling converges on whatever the supplier wants, and one that can commit
 * money is a different kind of tool than one that can hold a conversation. The
 * ceiling makes the negotiation real; the spending stop keeps it a negotiation.
 */
import { eq } from "drizzle-orm";
import { db, projects, requirements } from "../db";
import { num } from "../pricing/landed";
import { projectPricing, type TierWalkAway } from "../pricing/project";

export interface PriceCeiling {
  itemName: string;
  tiers: TierWalkAway[];
}

export interface Mandate {
  /** 1 = facts only. 3 = negotiate price and specification. */
  tier: number;
  /** True when the agent may open a price discussion at all. */
  mayNegotiatePrice: boolean;
  /** True when a supplier's proposed substitution may be accepted. */
  maySubstituteSpec: boolean;
  sampleBudgetUsd: number;
  maxToolingUsd: number;
  maxRounds: number;
  ceilings: PriceCeiling[];
  /** Requirements that may never be traded away. */
  nonNegotiable: string[];
  /** Why the mandate cannot be used yet, if it cannot. */
  blockedReason: string | null;
}

/**
 * Things no tier unlocks.
 *
 * Written into the prompt verbatim rather than left implicit. Each one is a
 * point where a sentence in an email becomes a commitment the company has to
 * honour, and none of them is made safer by the agent being good at its job.
 */
export const ABSOLUTE_LIMITS = [
  "Never place an order, confirm a purchase order, or tell a supplier to begin production.",
  "Never agree to pay a deposit, and never confirm bank details or accept an invoice.",
  "Never agree a unit price above the ceiling given for that quantity tier.",
  "Never agree tooling, mould or sample costs above the stated budgets.",
  "Never waive a requirement listed as non-negotiable, whatever reason is offered.",
  "Never state a delivery date, a shipping booking, or a launch date as a commitment.",
  "Never share another supplier's price, name, or quotation.",
];

export async function loadMandate(projectId: string): Promise<Mandate> {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) throw new Error("Project not found");

  const tier = project.autonomyTier;
  const pricing = await projectPricing(projectId);

  const ceilings: PriceCeiling[] = pricing.products
    .filter((p) => p.tiers.length > 0)
    .map((p) => ({ itemName: p.name, tiers: p.tiers }));

  /*
   * Compliance and safety requirements stay off the table by default. A
   * supplier proposing to drop lab testing is proposing that you carry the
   * liability, and they are the party who gains from it.
   */
  const parsed = await db
    .select({
      text: requirements.text,
      category: requirements.category,
      isMandatory: requirements.isMandatory,
    })
    .from(requirements)
    .where(eq(requirements.projectId, projectId));

  /*
   * Certification is off the table because a supplier proposing to drop lab
   * testing is proposing that you carry the liability. Weight capacity is off
   * because it is what the product is for and what a review complains about
   * when it fails. Quality issues are off because they name a defect that
   * already cost you a production run.
   */
  const nonNegotiable = parsed
    .filter(
      (r) =>
        r.category === "certification" ||
        r.category === "weight_capacity" ||
        r.category === "quality_issue",
    )
    .map((r) => r.text);

  // Negotiating without a ceiling is not negotiating, it is conceding slowly.
  const blockedReason =
    tier >= 3 && ceilings.length === 0
      ? "אין מחיר walk-away - המודל הכלכלי חסר נתונים, ובלי תקרה אין על מה להתמקח"
      : null;

  return {
    tier,
    mayNegotiatePrice: tier >= 3 && ceilings.length > 0,
    maySubstituteSpec: tier >= 3 && project.allowSpecSubstitution,
    sampleBudgetUsd: num(project.sampleBudgetUsd) ?? 0,
    maxToolingUsd: num(project.maxToolingUsd) ?? 0,
    maxRounds: project.maxNegotiationRounds,
    ceilings,
    nonNegotiable,
    blockedReason,
  };
}

/** The mandate as prompt text, so the model negotiates against real numbers. */
export function mandateBrief(mandate: Mandate): string {
  if (!mandate.mayNegotiatePrice) return "";

  const lines: string[] = [
    "NEGOTIATION MANDATE",
    "",
    "You may negotiate price and terms within these limits. Open at the RFQ",
    "target price. Never reveal the ceiling - it is your walk-away, not an offer.",
    "",
    "PRICE CEILINGS (per unit, FOB, USD):",
  ];

  for (const ceiling of mandate.ceilings) {
    for (const tier of ceiling.tiers) {
      const target = tier.rfqTargetFob === null ? "-" : `$${tier.rfqTargetFob.toFixed(2)}`;
      lines.push(
        `- ${ceiling.itemName} at ${tier.qty} pcs: open at ${target}, ` +
          `absolute maximum $${tier.walkAwayFob.toFixed(2)}`,
      );
    }
  }

  lines.push(
    "",
    `Sample spend allowed: ${mandate.sampleBudgetUsd > 0 ? `up to $${mandate.sampleBudgetUsd}` : "none - do not agree to any sample cost"}`,
    `Tooling spend allowed: ${mandate.maxToolingUsd > 0 ? `up to $${mandate.maxToolingUsd}` : "none - do not agree to any tooling cost"}`,
    mandate.maySubstituteSpec
      ? "You may accept a supplier's alternative material or construction if it meets the stated performance and you say plainly what changed."
      : "You may NOT accept any change to the specification. Record what they propose and say it needs to be reviewed.",
    "",
    "NON-NEGOTIABLE REQUIREMENTS - never trade these away:",
    ...(mandate.nonNegotiable.length > 0
      ? mandate.nonNegotiable.map((r) => `- ${r}`)
      : ["- (none recorded)"]),
    "",
    "ABSOLUTE LIMITS - these hold at every autonomy level:",
    ...ABSOLUTE_LIMITS.map((l) => `- ${l}`),
    "",
    `After ${mandate.maxRounds} rounds without agreement, stop and hand the thread over.`,
  );

  return lines.join("\n");
}
