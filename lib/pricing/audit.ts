/**
 * Is the target price wrong, or is the margin expectation?
 *
 * The question this exists to answer was asked by the person running the
 * programme, and it is the right question: here is the selling price, the fees
 * and the freight, here is what is left for sourcing - so how is it that every
 * seller manages at these prices and we are nowhere near? What are we doing
 * wrong? Are we asking for too much?
 *
 * Nothing in the system could answer it, because everything ran forwards. The
 * RFQ states a target, quotes are measured against it, and a supplier who
 * cannot meet it is a supplier who failed. That framing cannot produce the
 * finding that the target itself is the problem - and when three independent
 * factories say a number is impossible, that is the most likely finding.
 *
 * So this runs the same arithmetic backwards, from the real quotes:
 *
 *   forwards   retail, fees, freight, desired ROI  ->  what we may pay
 *   backwards  what they actually charge           ->  what we would earn
 *                                                  ->  what retail would need to be
 *
 * The numbers are computed here rather than written by a model. What the model
 * contributes is the reading of them, which is the part a person actually
 * wanted: not "walk-away is $22.50" but "at 100% ROI this product needs a
 * factory price nobody in the category charges".
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { buildComparison } from "../quotes/compare";

export interface AuditInput {
  /** Planned selling price per unit. */
  retailUsd: number;
  /** Marketplace commission, as a share of revenue. */
  referralPct: number;
  /** Advertising, as a share of revenue. */
  ppcPct: number;
  /** Fulfilment fee per unit at this size and weight. */
  fbaFeeUsd: number;
  /** All the way to the warehouse, per unit. Sea freight plus inbound. */
  freightUsdPerUnit: number;
  /** Import duty on the customs value. Nil unless the RFQ says otherwise. */
  dutyRatePct: number;
  /** 1 = the unit must return its own landed cost. */
  targetRoi: number;
}

export interface QuoteFact {
  company: string;
  fob: number;
  qty: number | null;
  /** Their price against the RFQ target, as the table shows it. */
  gapPct: number | null;
}

export interface AuditResult {
  input: AuditInput;
  /** What the sale leaves once the marketplace has taken its share. */
  netRevenue: number;
  /** The most a unit may cost landed and still clear the ROI rule. */
  maxLanded: number;
  /** The most we may pay the factory to clear it. */
  walkAwayFob: number;
  /** The RFQ's stated target, for comparison with the walk-away. */
  rfqTarget: number | null;
  /** The cheapest real quote we hold. */
  best: QuoteFact | null;
  /** Every priced supplier, cheapest first. */
  quotes: QuoteFact[];
  /** What we would actually earn at the best real price. */
  roiAtBest: number | null;
  landedAtBest: number | null;
  /** Retail needed to hit the target ROI at the best real price. */
  retailForTargetRoi: number | null;
  /** How many factories said the target cannot be met at any price. */
  refusals: number;
  /** Hebrew. The reading of the numbers above. */
  verdictHe: string | null;
}

/** Revenue after the marketplace, advertising and fulfilment. */
export function netRevenue(input: AuditInput): number {
  const referral = input.retailUsd * (input.referralPct / 100);
  const ppc = input.retailUsd * (input.ppcPct / 100);
  return input.retailUsd - referral - ppc - input.fbaFeeUsd;
}

/**
 * ROI = (net revenue - landed) / landed, so ROI >= target rearranges to
 * landed <= net / (1 + target); and since duty scales with the factory price,
 * FOB <= (max landed - freight) / (1 + duty).
 */
export function walkAway(input: AuditInput): { net: number; maxLanded: number; fob: number } {
  const net = netRevenue(input);
  const maxLanded = net / (1 + input.targetRoi);
  const fob = (maxLanded - input.freightUsdPerUnit) / (1 + input.dutyRatePct / 100);
  return { net, maxLanded, fob };
}

export function landedAt(fob: number, input: AuditInput): number {
  return fob + fob * (input.dutyRatePct / 100) + input.freightUsdPerUnit;
}

export function roiAt(fob: number, input: AuditInput): number {
  const landed = landedAt(fob, input);
  return landed > 0 ? (netRevenue(input) - landed) / landed : 0;
}

/**
 * The retail price that would make the target ROI work at a price a factory
 * will actually charge.
 *
 * This is the half of the answer nobody had. If the number comes back close to
 * what the product sells for, the target was merely optimistic; if it comes
 * back well above, the margin rule and this product are not compatible and no
 * amount of negotiating fixes that.
 */
export function retailForRoi(fob: number, input: AuditInput): number {
  const landed = landedAt(fob, input);
  const requiredNet = landed * (1 + input.targetRoi);
  const keptShare = 1 - input.referralPct / 100 - input.ppcPct / 100;
  if (keptShare <= 0) return Number.POSITIVE_INFINITY;
  return (requiredNet + input.fbaFeeUsd) / keptShare;
}

const Verdict = z.object({
  /** Two to five sentences, Hebrew, plain. */
  verdict_he: z.string(),
});

async function writeVerdict(
  productName: string,
  result: Omit<AuditResult, "verdictHe">,
): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  const money = (value: number | null) =>
    value === null || !Number.isFinite(value) ? "-" : `$${value.toFixed(2)}`;
  const pct = (value: number | null) =>
    value === null || !Number.isFinite(value) ? "-" : `${(value * 100).toFixed(0)}%`;

  const facts = [
    `PRODUCT: ${productName}`,
    `Retail: ${money(result.input.retailUsd)}`,
    `Marketplace commission: ${result.input.referralPct}%`,
    `Advertising: ${result.input.ppcPct}%`,
    `Fulfilment fee: ${money(result.input.fbaFeeUsd)}`,
    `Freight to warehouse: ${money(result.input.freightUsdPerUnit)} per unit`,
    `Duty: ${result.input.dutyRatePct}%`,
    `Required ROI: ${pct(result.input.targetRoi)}`,
    "",
    `Net revenue after fees: ${money(result.netRevenue)}`,
    `Maximum landed cost at that ROI: ${money(result.maxLanded)}`,
    `Maximum factory price at that ROI: ${money(result.walkAwayFob)}`,
    `Target price stated in the RFQ: ${money(result.rfqTarget)}`,
    "",
    result.best
      ? `Cheapest real quote: ${money(result.best.fob)} from ${result.best.company}`
      : "No supplier has given a price yet.",
    result.roiAtBest !== null ? `ROI at that price: ${pct(result.roiAtBest)}` : "",
    result.landedAtBest !== null ? `Landed cost at that price: ${money(result.landedAtBest)}` : "",
    result.retailForTargetRoi !== null
      ? `Retail needed to reach the required ROI at that price: ${money(result.retailForTargetRoi)}`
      : "",
    `Factories that said the target is impossible: ${result.refusals}`,
    "",
    "ALL QUOTES:",
    ...result.quotes.map((q) => `- ${q.company}: ${money(q.fob)}${q.qty ? ` at ${q.qty}` : ""}`),
  ]
    .filter(Boolean)
    .join("\n");

  const stream = new Anthropic().messages.stream({
    model: "claude-opus-5",
    max_tokens: 2000,
    output_config: { effort: "medium", format: zodOutputFormat(Verdict) },
    system: `You are a sourcing analyst. You are given a product's economics and the
prices factories have actually quoted. Say plainly whether the target price is
achievable, and if it is not, say which assumption is the one that has to give.

The question being asked is real and specific: every seller in this category
manages at these retail prices, so if we cannot, either we are paying too much,
selling too cheap, or demanding a return the category does not support. Say
which. Do not hedge across all three.

Rules:
- Use only the numbers given. Never invent a figure.
- If several factories independently refused the target, treat that as evidence
  about the target rather than about the factories.
- If the required ROI implies a factory price well below every real quote, say
  so directly: the margin rule and this product are not compatible.
- Name the specific change that would make it work - a retail price, an ROI, or
  a factory price - with the number.
- Hebrew. Two to five sentences. Short hyphens (-), never long dashes.
- No preamble, no restating the inputs. Start with the finding.`,
    messages: [{ role: "user", content: facts }],
  });

  /*
   * Read the text block and parse it, which is what the rest of the codebase
   * does. `parsed_output` was returning the verdict with a trailing `"}` still
   * attached - a fragment of the envelope leaking into the prose, which in a
   * paragraph shown to an operator reads as a bug in the analysis rather than
   * in the plumbing.
   */
  const message = await stream.finalMessage();
  const json = message.content.find((block) => block.type === "text")?.text;
  if (!json) return null;

  try {
    return Verdict.parse(JSON.parse(json)).verdict_he;
  } catch {
    return null;
  }
}

/**
 * Audit a project's target price against what factories actually charge.
 *
 * Quotes come from the comparison the page renders, so this cannot disagree
 * with the table about what anybody offered.
 */
export async function auditTarget(
  projectId: string,
  productName: string,
  input: AuditInput,
  options: { explain?: boolean } = {},
): Promise<AuditResult> {
  const comparison = await buildComparison(projectId);

  /*
   * Only lines that price one of our products.
   *
   * The first run of this reported the ladder project returning 824% and
   * advised dropping the retail price by ninety dollars. The cheapest quotes it
   * found were $1.25 and $1.50 - a tool bag and a spare wheel. Taking the
   * cheapest number in the quote is how you conclude that a supplier is
   * spectacularly cheap when what they were cheap about was a castor.
   *
   * The test is whether the line matched one of our products, not whether a
   * target existed for its quantity. A flat price with no tier is still a real
   * price for a real product - filtering on the target dropped Wellmade's
   * $62.68 ladder and left the analysis reading one quote instead of two.
   */
  const quotes: QuoteFact[] = comparison.suppliers
    .flatMap((supplier) =>
      supplier.lines
        .filter((line) => line.quotedFob !== null && line.matchedItem !== null)
        .map((line) => ({
          company: supplier.company,
          fob: line.quotedFob as number,
          qty: line.qty,
          gapPct: line.gapPct,
        })),
    )
    .sort((a, b) => a.fob - b.fob);

  // One row per supplier - their cheapest line - so a factory quoting three
  // tiers does not fill the list and drown the others.
  const byCompany = new Map<string, QuoteFact>();
  for (const quote of quotes) {
    if (!byCompany.has(quote.company)) byCompany.set(quote.company, quote);
  }
  const perSupplier = [...byCompany.values()].sort((a, b) => a.fob - b.fob);

  const { net, maxLanded, fob } = walkAway(input);
  const best = perSupplier[0] ?? null;

  const rfqTarget = comparison.targetByQty
    ? ([...comparison.targetByQty.values()].sort((a, b) => a - b)[0] ?? null)
    : null;

  const partial: Omit<AuditResult, "verdictHe"> = {
    input,
    netRevenue: net,
    maxLanded,
    walkAwayFob: fob,
    rfqTarget,
    best,
    quotes: perSupplier,
    roiAtBest: best ? roiAt(best.fob, input) : null,
    landedAtBest: best ? landedAt(best.fob, input) : null,
    retailForTargetRoi: best ? retailForRoi(best.fob, input) : null,
    refusals: comparison.refusals,
  };

  const verdictHe = options.explain === false ? null : await writeVerdict(productName, partial);

  return { ...partial, verdictHe };
}
