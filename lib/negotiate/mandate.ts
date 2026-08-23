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
import { ACCEPTABLE_GAP_PCT, ceilingFor } from "../pricing/target";
import { db as database, items } from "../db";

export interface CeilingTier {
  qty: number;
  /** The RFQ's own number - what we open at. */
  target: number;
  /** Target plus the accepted gap. Never revealed to a supplier. */
  ceiling: number;
}

export interface PriceCeiling {
  itemName: string;
  tiers: CeilingTier[];
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

  /*
   * The ceiling is the target plus the gap the operator is willing to close.
   * No retail price, no fee stack, no freight estimate: the target already
   * embeds all of it, and rebuilding it from parts only introduced a second,
   * shakier answer to a question that was already settled.
   */
  const priced = await database.select().from(items).where(eq(items.projectId, projectId));

  const ceilings: PriceCeiling[] = priced
    .filter((item) => item.kind === "priced_variant" && item.targetPrices.length > 0)
    .map((item) => ({
      itemName: item.name,
      tiers: item.targetPrices
        .filter((p) => p.unit_price !== null && p.qty !== null)
        .map((p) => ({
          qty: p.qty as number,
          target: p.unit_price as number,
          ceiling: ceilingFor(p.unit_price as number),
        }))
        .sort((a, b) => a.qty - b.qty),
    }))
    .filter((c) => c.tiers.length > 0);

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
      ? "אין מחיר מטרה ב-RFQ - בלי תקרה אין על מה להתמקח"
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
    "Your goal is to land as close to the target price as possible. Open at the",
    "target. Never reveal the ceiling - it is your walk-away, not an offer.",
    `A quote within ${ACCEPTABLE_GAP_PCT}% of target is worth taking forward; further`,
    "away, keep working or say plainly that it is too far apart.",
    "",
    "PRICE CEILINGS (per unit, FOB, USD):",
  ];

  for (const ceiling of mandate.ceilings) {
    for (const tier of ceiling.tiers) {
      lines.push(
        `- ${ceiling.itemName} at ${tier.qty} pcs: open at $${tier.target.toFixed(2)}, ` +
          `absolute maximum $${tier.ceiling.toFixed(2)}`,
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
