/**
 * Every supplier's numbers side by side, against what we can afford to pay.
 *
 * The comparison is the point of the whole exercise, and the reason it needs
 * code rather than a spreadsheet is that a quoted price is not comparable on
 * its own. One supplier quotes FOB and another EXW; one packs three to a carton
 * and another three hundred; one is quoting the kit and another the basket
 * alone. Landed cost is where those differences become the same unit, and the
 * walk-away is what turns that into a verdict.
 *
 * Refusals appear too, with their reason. Three suppliers saying the target is
 * unreachable is the most useful row in the table, and it only exists if the
 * ones who said no are still in it.
 */
import { desc, eq } from "drizzle-orm";
import { db, quoteReadings, suppliers } from "../db";
import { estimateSeaFreight } from "../pricing/freight";
import { landedCost, num, type CommercialAssumptions } from "../pricing/landed";
import { projectPricing } from "../pricing/project";

export interface ComparisonLine {
  qty: number | null;
  itemName: string;
  quotedFob: number | null;
  /** Their price carried through freight and duty to the warehouse. */
  landed: number | null;
  /** What we may pay at this quantity, from the model. */
  walkAway: number | null;
  /**
   * The landed ceiling, so the two landed figures sit in the same unit. Showing
   * landed cost beside an FOB ceiling made a passing line look like a breach.
   */
  maxLanded: number | null;
  /** Positive means room to spare. */
  headroom: number | null;
  passes: boolean | null;
  specNote: string | null;
}

export interface SupplierComparison {
  supplierId: string;
  company: string;
  incoterm: string | null;
  moq: number | null;
  leadTimeDays: number | null;
  paymentTerms: string | null;
  unitsPerCarton: number | null;
  cartonDimensionsCm: string | null;
  certificates: string[];
  deviations: { our_requirement: string; what_they_offer: string; their_reason: string | null }[];
  rejectsTargetPrice: boolean;
  priceObjection: string | null;
  summaryHe: string | null;
  lines: ComparisonLine[];
  /** Best headroom across the lines, for ranking. Null when they never priced. */
  bestHeadroom: number | null;
  readAt: Date;
}

export interface Comparison {
  suppliers: SupplierComparison[];
  /** Null until the commercial model is complete. */
  walkAwayByQty: Map<number, number> | null;
  /** How many said the target cannot be met, whatever price they named. */
  refusals: number;
}

/**
 * Carton packing beats unit price on bulky goods, so use the supplier's own
 * packing when they gave it and fall back to the project estimate when not.
 */
function cbmPerUnitFrom(
  cartonDimensionsCm: string | null,
  unitsPerCarton: number | null,
  fallback: number,
): number {
  if (!cartonDimensionsCm || !unitsPerCarton || unitsPerCarton <= 0) return fallback;

  const numbers = cartonDimensionsCm.match(/\d+(?:\.\d+)?/g);
  if (!numbers || numbers.length < 3) return fallback;

  const [l, w, h] = numbers.slice(0, 3).map(Number);
  if (!l || !w || !h) return fallback;

  // Centimetres to cubic metres, then per unit.
  return (l * w * h) / 1_000_000 / unitsPerCarton;
}

export async function buildComparison(projectId: string): Promise<Comparison> {
  const [pricing, readings] = await Promise.all([
    projectPricing(projectId),
    db
      .select({
        supplierId: quoteReadings.supplierId,
        company: suppliers.companyName,
        incoterm: quoteReadings.incoterm,
        place: quoteReadings.incotermPlace,
        lines: quoteReadings.lines,
        moq: quoteReadings.moq,
        leadTimeDays: quoteReadings.leadTimeDays,
        paymentTerms: quoteReadings.paymentTerms,
        unitsPerCarton: quoteReadings.unitsPerCarton,
        cartonDimensionsCm: quoteReadings.cartonDimensionsCm,
        certificates: quoteReadings.certificates,
        deviations: quoteReadings.deviations,
        rejectsTargetPrice: quoteReadings.rejectsTargetPrice,
        priceObjection: quoteReadings.priceObjection,
        summaryHe: quoteReadings.summaryHe,
        createdAt: quoteReadings.createdAt,
      })
      .from(quoteReadings)
      .innerJoin(suppliers, eq(quoteReadings.supplierId, suppliers.id))
      .where(eq(quoteReadings.projectId, projectId))
      .orderBy(desc(quoteReadings.createdAt)),
  ]);

  // The main priced product carries the walk-away used for comparison.
  const product = pricing.products.find((p) => p.tiers.length > 0) ?? null;
  const walkAwayByQty = product
    ? new Map(product.tiers.map((t) => [t.qty, t.walkAwayFob]))
    : null;

  const commercial = pricing.commercial as CommercialAssumptions;
  const fallbackCbm = product?.product.cbmPerUnit ?? 0;

  /*
   * One row per supplier - their most recent reading. A supplier who wrote four
   * times produced four rows in the raw table, and showing all of them turns
   * the comparison back into an inbox.
   */
  const latest = new Map<string, (typeof readings)[number]>();
  for (const reading of readings) {
    if (!latest.has(reading.supplierId)) latest.set(reading.supplierId, reading);
  }

  const out: SupplierComparison[] = [];

  for (const reading of latest.values()) {
    const cbmPerUnit = cbmPerUnitFrom(
      reading.cartonDimensionsCm,
      reading.unitsPerCarton,
      fallbackCbm,
    );

    const lines: ComparisonLine[] = reading.lines.map((line) => {
      const walkAway =
        line.qty !== null && walkAwayByQty ? (walkAwayByQty.get(line.qty) ?? null) : null;

      let landed: number | null = null;
      if (line.unit_price !== null && cbmPerUnit > 0 && line.qty !== null) {
        const freight = estimateSeaFreight(cbmPerUnit * line.qty);
        landed = landedCost(
          line.unit_price,
          { ...commercial, freightUsdPerCbm: freight.usdPerCbm },
          cbmPerUnit,
        ).landed;
      }

      const headroom =
        walkAway !== null && line.unit_price !== null ? walkAway - line.unit_price : null;

      return {
        qty: line.qty,
        itemName: line.item_name,
        quotedFob: line.unit_price,
        landed,
        maxLanded: product?.verdict?.maxLanded ?? null,
        walkAway,
        headroom,
        passes: headroom === null ? null : headroom >= 0,
        specNote: line.spec_note,
      };
    });

    const headrooms = lines.map((l) => l.headroom).filter((h): h is number => h !== null);

    out.push({
      supplierId: reading.supplierId,
      company: reading.company ?? "ספק",
      incoterm: reading.incoterm
        ? `${reading.incoterm}${reading.place ? ` ${reading.place}` : ""}`
        : null,
      moq: reading.moq,
      leadTimeDays: reading.leadTimeDays,
      paymentTerms: reading.paymentTerms,
      unitsPerCarton: reading.unitsPerCarton,
      cartonDimensionsCm: reading.cartonDimensionsCm,
      certificates: reading.certificates,
      deviations: reading.deviations,
      rejectsTargetPrice: reading.rejectsTargetPrice,
      priceObjection: reading.priceObjection,
      summaryHe: reading.summaryHe,
      lines,
      bestHeadroom: headrooms.length > 0 ? Math.max(...headrooms) : null,
      readAt: reading.createdAt,
    });
  }

  // Priced suppliers first, best headroom at the top; refusals after them, since
  // they carry information rather than an offer.
  out.sort((a, b) => {
    if (a.bestHeadroom === null && b.bestHeadroom === null) return 0;
    if (a.bestHeadroom === null) return 1;
    if (b.bestHeadroom === null) return -1;
    return b.bestHeadroom - a.bestHeadroom;
  });

  return {
    suppliers: out,
    walkAwayByQty,
    refusals: out.filter((s) => s.rejectsTargetPrice).length,
  };
}

/** A numeric column arrives as a string. */
export { num };
