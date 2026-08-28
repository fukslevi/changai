/**
 * Builds the first-contact email from the parsed RFQ.
 *
 * Deliberately deterministic rather than model-generated. The extraction step
 * already did the hard reading; composing structured data into a structured
 * email needs no second model call - and when the same text goes to twenty
 * suppliers you want to know exactly what it says, identically every time, so
 * that the replies are comparable. The operator edits it before anything sends.
 *
 * {{company}} is substituted per recipient at send time. It is the only
 * personalisation, and it is why we send twenty individual emails rather than
 * one message with twenty BCCs.
 */

import type { items as itemsTable, projects as projectsTable, requirements as reqTable } from "../db/tables";

type Project = typeof projectsTable.$inferSelect;
type Item = typeof itemsTable.$inferSelect;
type Requirement = typeof reqTable.$inferSelect;

export const COMPANY_PLACEHOLDER = "{{company}}";

const SECTION_ORDER: { categories: Requirement["category"][]; heading: string }[] = [
  { categories: ["packaging"], heading: "PACKAGING" },
  { categories: ["insert_manual", "logo_branding"], heading: "INSERT AND BRANDING" },
  { categories: ["certification"], heading: "CERTIFICATION" },
];

/**
 * Four asks, not eight, and the order is the measured one.
 *
 * Across eleven quotations that actually carried a price, this is what came
 * back: unit price 100%, incoterm 82%, payment terms 55%, lead time 45%, MOQ
 * 27%, certificates 27%, units per carton 18%, tooling 9%, carton dimensions
 * 9%, sample price 0%. Asking for eight things reliably produced two.
 *
 * A long list does not gather more, it buries what matters - and the buried
 * item was the sample price, requested of every supplier and supplied by none.
 * Carton dimensions and tooling do matter, but only for a factory still in
 * contention, and they can be asked once there is a price worth pursuing.
 * Asking all thirty up front costs the price we actually wanted.
 */
const ASKS = [
  "Unit price at each quantity (FOB or EXW - say which)",
  "MOQ",
  "Lead time",
  "Payment terms",
];

function formatQty(tiers: number[]): string {
  return tiers.map((t) => `${t.toLocaleString("en-US")} sets`).join("  ·  ");
}

export function buildOutreachEmail(
  project: Project,
  allItems: Item[],
  allRequirements: Requirement[],
  sender: { name: string; title: string },
): { subject: string; body: string } {
  const priced = allItems.filter((i) => i.kind === "priced_variant");
  const bundled = allItems.filter((i) => i.kind === "bundled_component");
  const optional = allItems.filter((i) => i.kind === "optional_addon");

  const tiers = project.quantityTiers;
  const subject =
    tiers.length > 0
      ? `${project.name} - RFQ for ${tiers.map((t) => t.toLocaleString("en-US")).join(" / ")} sets`
      : `${project.name} - request for quotation`;

  const lines: string[] = [];

  lines.push(`Hello ${COMPANY_PLACEHOLDER},`, "");
  lines.push(
    "We are SoSimple, an Amazon US brand. We would like your quotation for the",
    "product below.",
    "",
  );

  /* Product ----------------------------------------------------------------
     Never order priced items alphabetically - "Folding Rear Bike Basket" would
     sort ahead of "Rear Bike Basket" and the accessories would be attributed to
     the wrong product. The primary is the one accessories actually attach to. */
  const childrenOf = new Map<string, Item[]>();
  for (const b of bundled) {
    if (!b.parentItemId) continue;
    const list = childrenOf.get(b.parentItemId) ?? [];
    list.push(b);
    childrenOf.set(b.parentItemId, list);
  }

  const ranked = [...priced].sort(
    (a, b) => (childrenOf.get(b.id)?.length ?? 0) - (childrenOf.get(a.id)?.length ?? 0),
  );
  const main = ranked[0];
  const unattached = bundled.filter((b) => !b.parentItemId);

  /*
   * The parts are listed separately, and quoting some of them is allowed.
   *
   * Presented as one kit, a single component disqualifies the whole enquiry:
   * Baopeng manufacture soft kettlebells and declined the entire RFQ because
   * "the Soft Kettlebell with an electronic reps counter is outside our current
   * manufacturing scope". A weights factory was lost over a piece of
   * electronics we would happily buy elsewhere.
   *
   * So the kit is named, its parts are itemised, and the mail says plainly that
   * a partial quote is welcome. Nothing about what we want changes - only
   * whether a factory has to be able to make all of it before it may answer.
   */
  lines.push("PRODUCT");
  if (main) {
    const children = [...(childrenOf.get(main.id) ?? []), ...unattached];
    lines.push(`${main.name}.`);

    if (children.length > 0) {
      lines.push("", "Supplied as a kit with:");
      for (const child of children) {
        lines.push(`  • ${stripParent(child.name, main.name)}`);
      }
    }
  }
  for (const extra of ranked.slice(1)) {
    const children = childrenOf.get(extra.id) ?? [];
    const kit =
      children.length > 0
        ? ` with ${listPhrase(children.map((c) => stripParent(c.name, extra.name)))}`
        : "";
    lines.push(
      `We are also quoting a ${extra.name}${kit} in the same round - please price it as well if you manufacture it.`,
    );
  }
  if (optional.length > 0) {
    lines.push(
      "",
      `Optional, price separately if available: ${listPhrase(optional.map((o) => o.name))}.`,
    );
  }

  // The line that lets a capable factory answer instead of declining.
  const hasParts = bundled.length > 0 || optional.length > 0 || ranked.length > 1;
  if (hasParts) {
    /*
     * "Leave out", not "price at zero". The first draft of this line invited a
     * zero, and a zero is a price - it would land in the comparison as a line
     * infinitely below target and take the top of the table with it.
     */
    lines.push(
      "",
      "You do not need to make every part. Quote the items you manufacture and",
      "leave the others out - we source those separately.",
    );
  }
  lines.push("");

  /* Quantities ------------------------------------------------------------- */
  if (tiers.length > 0) {
    /*
     * FOB preferred, EXW accepted - and the difference is a quote we lost.
     *
     * Junpai Sun Shading answered with MOQ, lead time, payment terms, sample
     * price and their SGS certificate, and no price: "for order less than full
     * container order, our price terms is ex-work". A factory that only sells
     * FOB on full containers cannot price an LCL enquiry at all, so insisting
     * on FOB turned a supplier who had done all the work into a blank.
     *
     * Saying we accept EXW costs nothing - the freight is ours to arrange
     * either way - and removes the only reason that supplier had to stop.
     */
    lines.push(`QUANTITIES - please quote all ${tiers.length}, in ${project.currency}`);
    lines.push(`  ${formatQty(tiers)}`, "");
    lines.push(
      "FOB China preferred. If you only quote EXW for orders below a full",
      "container, send EXW - we arrange collection in China.",
      "",
    );
  }

  /* Quality issues get their own section, above the routine requirements -
     a defect we have already rejected production over is not another bullet. */
  const quality = allRequirements.filter((r) => r.category === "quality_issue");
  if (quality.length > 0) {
    lines.push("QUALITY - ISSUES FROM PREVIOUS PRODUCTION");
    for (const q of quality) lines.push(`  • ${clean(q.text)}`);
    lines.push("");
  }

  /* Shared requirements ---------------------------------------------------- */
  for (const section of SECTION_ORDER) {
    const matching = allRequirements.filter((r) => section.categories.includes(r.category));
    if (matching.length === 0) continue;
    lines.push(section.heading);
    for (const r of matching) lines.push(`  • ${clean(r.text)}`);

    /*
     * A certificate a factory does not yet hold is a cost they have to price
     * before they can price anything, and several stopped there rather than
     * come back with a number. Asking for both prices lets them answer without
     * committing to the certification first.
     */
    if (section.heading === "CERTIFICATION") {
      lines.push(
        "  • If you do not hold these yet, quote both ways - your price with",
        "    certification and without - rather than not quoting.",
      );
    }
    lines.push("");
  }

  /* The ask ---------------------------------------------------------------- */
  lines.push("PLEASE SEND");
  ASKS.forEach((ask, i) => lines.push(`  ${i + 1}. ${ask}`));
  lines.push("");

  /* An explicit out raises reply rate and cuts pointless follow-up. */
  lines.push(
    "If you do not make this product, just reply and say so - we will not follow",
    "up.",
    "",
    "Best regards,",
    sender.name,
    `${sender.title}, SoSimple`,
  );

  return { subject, body: lines.join("\n") };
}

/**
 * "PU Bag for Rear bike basket" → "PU Bag" when the parent is already named.
 * Matches loosely on the parent's words rather than the exact string: the RFQ
 * writes the parent inconsistently ("Rear bike basket" vs "Rear Bike Basket"),
 * and an exact match silently leaves the suffix in place.
 */
function stripParent(name: string, parent: string): string {
  const words = parent
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+");
  return name.replace(new RegExp(`\\s*\\bfor\\s+${words}\\s*$`, "i"), "").trim();
}

function listPhrase(values: string[]): string {
  if (values.length <= 1) return values[0] ?? "";
  return `${values.slice(0, -1).join(", ")} and ${values[values.length - 1]}`;
}

/**
 * Requirement text is quoted verbatim from the RFQ, so whatever punctuation the
 * document used arrives with it. Normalise dashes to a plain hyphen here rather
 * than trusting the source: em and en dashes render inconsistently in Chinese
 * mail clients, and this is the one place every line of supplier-facing text
 * passes through.
 */
function clean(text: string): string {
  return text
    .replace(/^[-•\s]+/, "")
    .replace(/[‒-―−]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}
