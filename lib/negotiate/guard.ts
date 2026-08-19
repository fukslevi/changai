/**
 * A last check on the text before it leaves.
 *
 * The mandate is in the prompt, and the model follows it. That is not the same
 * as it being impossible to break, and the failure here is expensive in a way
 * that a clumsy sentence is not: a number in an email is a number a supplier
 * will hold you to. So every draft written under a negotiation mandate is read
 * once more, by code, for the two things that cannot be walked back - a price
 * above the ceiling, and a commitment to spend.
 *
 * It is a backstop, not a substitute for the mandate being right.
 */
import type { Mandate } from "./mandate";

export interface GuardResult {
  safe: boolean;
  /** Hebrew, for the operator. */
  problems: string[];
}

/** Prices as written in a supplier email: $4.20, USD 4.20, 4.20/pc. */
const PRICE_PATTERN =
  /(?:US\s?\$|USD\s*|\$)\s*([0-9]+(?:\.[0-9]{1,2})?)|([0-9]+\.[0-9]{2})\s*(?:usd|per\s*(?:pc|piece|unit|set))/gi;

/**
 * First-person acceptance.
 *
 * This distinction is the whole point. Repeating a supplier's own number back
 * to them is how you argue against it, and the first version of this check
 * blocked a perfectly good draft for quoting the $18.00 it was pushing back on.
 * A guard that stops correct work gets switched off, so only sentences where we
 * are the ones agreeing count.
 */
const WE_ACCEPT =
  /\b(we|i)\s+(can|could|will|would|are able to|agree to|accept|are happy to|are fine with|are ok with)\b|\b(agreed|accepted|confirmed)\b|\b(that|this|it|the price)\s+(price\s+)?(works|is fine|is acceptable|is ok|is okay)\b|\bis\s+(fine|acceptable|ok|okay)\b|\bno\s+problem\b/i;

/**
 * Phrases that turn a discussion into an instruction. Deliberately broad: a
 * false positive costs one held thread, a false negative costs a production run
 * nobody authorised.
 */
const COMMITMENT_PATTERNS: [RegExp, string][] = [
  [/\b(place|placing|confirm(?:ing)?)\s+(the\s+)?(order|po|purchase order)\b/i, "אישור הזמנה"],
  [/\bwe\s+(will|would like to)\s+order\b/i, "התחייבות להזמין"],
  [/\b(start|begin|proceed with)\s+(mass\s+)?production\b/i, "הוראה להתחיל ייצור"],
  [/\bdeposit\s+(will|has)\s+be(en)?\s+(paid|sent|transferred)\b/i, "אישור תשלום מקדמה"],
  [/\bwe\s+(will|can)\s+pay\b/i, "התחייבות לתשלום"],
  [/\bsend\s+(us\s+)?(the\s+)?(proforma|invoice|pi)\b/i, "בקשת חשבונית - צעד לקראת הזמנה"],
  [/\bbank\s+(details|account)\b/i, "פרטי בנק"],
];

/** Sentence ends and list items, so context stays local to a claim. */
function segments(draft: string): string[] {
  return draft
    .split(/(?<=[.!?])\s+|\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * The highest ceiling in the mandate.
 *
 * Matching a loose number to the right product and tier would need to read the
 * sentence properly, and getting that wrong in either direction is worse than
 * the simple rule: nothing we write should ever agree to more than the most we
 * could pay for anything.
 */
function highestCeiling(mandate: Mandate): number | null {
  const all = mandate.ceilings.flatMap((c) => c.tiers.map((t) => t.walkAwayFob));
  return all.length > 0 ? Math.max(...all) : null;
}

export function checkDraft(draft: string, mandate: Mandate): GuardResult {
  const problems: string[] = [];

  for (const [pattern, label] of COMMITMENT_PATTERNS) {
    if (pattern.test(draft)) problems.push(`הטיוטה מכילה ${label}`);
  }

  const ceiling = highestCeiling(mandate);

  for (const segment of segments(draft)) {
    if (!WE_ACCEPT.test(segment)) continue;

    /*
     * Requiring acceptance language is what separates the two cases; there is
     * no second test for "this is their number". "We accept your price of $18"
     * contains both their price and our agreement, and it is the agreement that
     * matters.
     */
    if (ceiling !== null) {
      for (const match of segment.matchAll(PRICE_PATTERN)) {
        const value = Number(match[1] ?? match[2]);
        // Quantities and years read as numbers too; only sums in the plausible
        // range of a unit price are worth judging.
        if (!Number.isFinite(value) || value <= 0 || value > 10_000) continue;
        if (value > ceiling) {
          problems.push(
            `הטיוטה מסכימה ל-$${value.toFixed(2)}, מעל התקרה של $${ceiling.toFixed(2)}`,
          );
        }
      }
    }

    // Asking what a sample costs is not agreeing to pay for it.
    if (
      mandate.sampleBudgetUsd === 0 &&
      /\bsample\b[^.]{0,60}\b(cost|price|charge|fee)\b|\b(cost|price|charge|fee)\b[^.]{0,60}\bsample\b/i.test(
        segment,
      )
    ) {
      problems.push("הטיוטה מסכימה לעלות דגימה בזמן שאין תקציב דגימות");
    }

    if (mandate.maxToolingUsd === 0 && /\b(tooling|mould|mold)\b/i.test(segment)) {
      problems.push("הטיוטה מסכימה לעלות תבנית בזמן שאין תקציב תבניות");
    }
  }

  return { safe: problems.length === 0, problems: [...new Set(problems)] };
}
