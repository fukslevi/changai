/**
 * The numbers worth watching on a sourcing project, as a funnel.
 *
 * A reply rate on its own flatters the work. Sixteen of seventy-four factories
 * answered, which sounds like a third of a result - but a reply saying "we
 * cannot make this" is not a step towards buying anything. What matters is how
 * many of the ones who answered gave a price, and how many of those prices are
 * close enough to act on, and each stage loses most of what the one before it
 * produced. Showing only the first stage hides where the loss actually is.
 *
 *   contacted -> replied -> quoted -> within reach
 *
 * The last number is the only one that means the project is working. Everything
 * to its left is a rate that can look healthy while nothing arrives.
 *
 * Computed in one pass for every project rather than a query per row: the list
 * page renders all of them, and a per-row query on a list is the kind of cost
 * that is invisible at three projects and is the whole page load at thirty.
 */
import { inArray } from "drizzle-orm";
import { db, messages, outreach } from "./db";
import { buildComparison } from "./quotes/compare";

export interface ProjectStats {
  contacted: number;
  replied: number;
  /** Suppliers who sent an actual price, not just an answer. */
  quoted: number;
  /** Suppliers whose best price is inside the acceptable band. */
  inRange: number;
  /** Suppliers who said the target cannot be met at any price. */
  refused: number;
  /** Smallest gap from target across every quote. Null when nobody has priced. */
  bestGapPct: number | null;
  bestSupplier: string | null;
  /** Conversations where they wrote last, or we did and they may still answer. */
  liveThreads: number;
  replyRatePct: number | null;
  /** Of those who replied, how many gave a price. */
  quoteRatePct: number | null;
}

const EMPTY: ProjectStats = {
  contacted: 0,
  replied: 0,
  quoted: 0,
  inRange: 0,
  refused: 0,
  bestGapPct: null,
  bestSupplier: null,
  liveThreads: 0,
  replyRatePct: null,
  quoteRatePct: null,
};

function pct(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 100) : null;
}

export async function projectStats(
  ids: string[],
): Promise<Map<string, ProjectStats>> {
  const out = new Map<string, ProjectStats>();
  if (ids.length === 0) return out;

  const [outreachRows, inboundRows] = await Promise.all([
    db
      .select({ projectId: outreach.projectId, supplierId: outreach.supplierId })
      .from(outreach)
      .where(inArray(outreach.projectId, ids)),
    db
      .select({
        projectId: messages.projectId,
        supplierId: messages.supplierId,
        direction: messages.direction,
      })
      .from(messages)
      .where(inArray(messages.projectId, ids)),
  ]);

  for (const projectId of ids) {
    const contactedIds = new Set(
      outreachRows.filter((o) => o.projectId === projectId).map((o) => o.supplierId),
    );

    const repliedIds = new Set(
      inboundRows
        .filter((m) => m.projectId === projectId && m.direction === "inbound" && m.supplierId)
        .map((m) => m.supplierId),
    );

    /*
     * The quote numbers come from the comparison the project page renders,
     * not from a second calculation here.
     *
     * The first version of this file worked the gaps out for itself and got
     * -89% for a supplier the table showed at +31%: it matched quote lines to
     * targets by quantity alone, so a line for a component or an odd tier fell
     * back to the cheapest target in the project and every ratio collapsed.
     *
     * Two rules for "how far off is this price" will always end up disagreeing,
     * and the one on the page is the one the operator has been reading. It
     * costs a query per project, which is the right trade for a number that is
     * correct.
     */
    const comparison = await buildComparison(projectId);

    /*
     * "Quoted" means they named a price, full stop. Whether we could measure
     * it against a target is a separate thing: a supplier quoting a flat price
     * with no quantity tier has still quoted, and counting them as silent
     * understates the stage that matters most.
     */
    const quotedSuppliers = comparison.suppliers.filter((supplier) =>
      supplier.lines.some((line) => line.quotedFob !== null),
    );

    const priced = comparison.suppliers.filter((supplier) => supplier.bestGapPct !== null);
    const inRange = priced.filter(
      (supplier) => (supplier.bestGapPct as number) <= comparison.acceptableGapPct,
    ).length;

    const closest = priced.reduce<(typeof priced)[number] | null>(
      (best, supplier) =>
        best === null || (supplier.bestGapPct as number) < (best.bestGapPct as number)
          ? supplier
          : best,
      null,
    );

    out.set(projectId, {
      ...EMPTY,
      contacted: contactedIds.size,
      replied: repliedIds.size,
      quoted: quotedSuppliers.length,
      inRange,
      refused: comparison.refusals,
      bestGapPct: closest?.bestGapPct ?? null,
      bestSupplier: closest?.company ?? null,
      liveThreads: repliedIds.size,
      replyRatePct: pct(repliedIds.size, contactedIds.size),
      quoteRatePct: pct(quotedSuppliers.length, repliedIds.size),
    });
  }

  return out;
}
