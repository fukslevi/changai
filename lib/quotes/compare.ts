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
import { db as database, items } from "../db";
import { num } from "../pricing/landed";
import { ACCEPTABLE_GAP_PCT, compareToTarget } from "../pricing/target";

export interface ComparisonLine {
  qty: number | null;
  itemName: string;
  quotedFob: number | null;
  /** Ours, from the RFQ. */
  target: number | null;
  /** How far above target, as a percentage of it. 50 = half again as much. */
  gapPct: number | null;
  /** Within the acceptable band. */
  acceptable: boolean | null;
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
  /** Smallest gap across the lines, for ranking. Null when they never priced. */
  bestGapPct: number | null;
  readAt: Date;
}

export interface Comparison {
  suppliers: SupplierComparison[];
  /** The RFQ's own target per quantity. */
  targetByQty: Map<number, number> | null;
  acceptableGapPct: number;
  /** How many said the target cannot be met, whatever price they named. */
  refusals: number;
}

export async function buildComparison(projectId: string): Promise<Comparison> {
  const [priced, readings] = await Promise.all([
    database.select().from(items).where(eq(items.projectId, projectId)),
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

  /*
   * The target price per quantity, straight from the RFQ. It is the only
   * benchmark: it already carries the buyer's own analysis, so deriving a
   * second one from retail price and freight added arithmetic without adding
   * information.
   */
  const targets = priced
    .filter((item) => item.kind === "priced_variant")
    .flatMap((item) => item.targetPrices)
    .filter((p) => p.qty !== null && p.unit_price !== null);

  const targetByQty =
    targets.length > 0
      ? new Map(targets.map((p) => [p.qty as number, p.unit_price as number]))
      : null;

  /*
   * One row per supplier - their most recent reading. A supplier who wrote four
   * times produced four rows in the raw table, and showing all of them turns
   * the comparison back into an inbox.
   */
  const latest = new Map<string, (typeof readings)[number]>();
  for (const reading of readings) {
    const held = latest.get(reading.supplierId);
    if (!held) {
      latest.set(reading.supplierId, reading);
      continue;
    }
    /*
     * Prefer the most recent reading that actually has prices. Peitai quoted in
     * full and then wrote again about something else; taking the newest row
     * blindly turned a supplier with nine priced lines into a blank refusal.
     */
    if (held.lines.length === 0 && reading.lines.length > 0) {
      latest.set(reading.supplierId, reading);
    }
  }

  const out: SupplierComparison[] = [];

  for (const reading of latest.values()) {
    const lines: ComparisonLine[] = reading.lines.map((line) => {
      const target =
        line.qty !== null && targetByQty ? (targetByQty.get(line.qty) ?? null) : null;

      const verdict =
        target !== null && line.unit_price !== null
          ? compareToTarget(line.unit_price, target)
          : null;

      return {
        qty: line.qty,
        itemName: line.item_name,
        quotedFob: line.unit_price,
        target,
        gapPct: verdict?.gapPct ?? null,
        acceptable: verdict?.acceptable ?? null,
        specNote: line.spec_note,
      };
    });

    const gaps = lines.map((l) => l.gapPct).filter((g): g is number => g !== null);

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
      bestGapPct: gaps.length > 0 ? Math.min(...gaps) : null,
      readAt: reading.createdAt,
    });
  }

  // Closest to target first; refusals after, since they carry information
  // rather than an offer.
  out.sort((a, b) => {
    if (a.bestGapPct === null && b.bestGapPct === null) return 0;
    if (a.bestGapPct === null) return 1;
    if (b.bestGapPct === null) return -1;
    return a.bestGapPct - b.bestGapPct;
  });

  return {
    suppliers: out,
    targetByQty,
    acceptableGapPct: ACCEPTABLE_GAP_PCT,
    refusals: out.filter((s) => s.rejectsTargetPrice).length,
  };
}

/** A numeric column arrives as a string. */
export { num };
