/**
 * Changing a target price, and working out who that changes things for.
 *
 * The write itself is small. The reason this is its own module is the second
 * half: a target price is not a private note, it is the number every open
 * negotiation is being conducted against. Moving it silently would leave the
 * agent arguing for a figure nobody holds any more.
 *
 * Which direction it moved decides who is affected, and the two cases are
 * opposites:
 *
 *   Raised  - the suppliers who said the old target was impossible are worth
 *             talking to again. Three factories told us $7.70 could not be done;
 *             at $9.50 that is a different conversation, and they are the ones
 *             who already know the product.
 *   Lowered - quotes that were inside the band are now outside it, including
 *             ones we may have been close to accepting.
 *
 * Nothing here writes to a supplier. Going back to a factory to say our price
 * has changed is a commercial move with a cost - it tells them we were flexible
 * - so it is proposed and the operator decides.
 */
import { and, eq } from "drizzle-orm";
import { db, items, targetRevisions } from "../db";
import type { PricePoint } from "../schema";
import { buildComparison } from "../quotes/compare";
import { ACCEPTABLE_GAP_PCT } from "./target";

export interface TargetChange {
  itemId: string;
  itemName: string;
  /** Null when the change applied to every tier. */
  qty: number | null;
  previous: number | null;
  next: number;
}

export type Direction = "raised" | "lowered" | "unchanged";

export interface AffectedSupplier {
  supplierId: string;
  company: string;
  /** What changed for them, in Hebrew. */
  whyHe: string;
  /** Where their best quote sat against the old target, and the new one. */
  gapBefore: number | null;
  gapAfter: number | null;
  /** They told us the old target could not be met. */
  refusedOldTarget: boolean;
}

export function directionOf(previous: number | null, next: number): Direction {
  if (previous === null) return "unchanged";
  if (next > previous) return "raised";
  if (next < previous) return "lowered";
  return "unchanged";
}

/**
 * Write the new target and keep the old one.
 *
 * `targetPrices` is a JSON array of points, so a tier that does not exist yet
 * is appended rather than skipped - an RFQ that never carried a target for the
 * 2,500 tier can be given one here without re-parsing the document.
 */
export async function reviseTarget(input: {
  projectId: string;
  itemId: string;
  qty: number | null;
  newUsd: number;
  reasonHe: string | null;
}): Promise<TargetChange> {
  const [item] = await db
    .select()
    .from(items)
    .where(and(eq(items.id, input.itemId), eq(items.projectId, input.projectId)));

  if (!item) throw new Error("Item not found");

  const points: PricePoint[] = [...item.targetPrices];
  const matches = (point: PricePoint) => input.qty === null || point.qty === input.qty;

  const previousPoint = points.find(matches);
  const previous = previousPoint?.unit_price ?? null;

  let touched = false;
  const updated = points.map((point) => {
    if (!matches(point)) return point;
    touched = true;
    return { ...point, unit_price: input.newUsd };
  });

  if (!touched) {
    updated.push({
      option_id: null,
      qty: input.qty,
      unit_price: input.newUsd,
      currency: "USD",
    });
  }

  await db.update(items).set({ targetPrices: updated }).where(eq(items.id, input.itemId));

  await db.insert(targetRevisions).values({
    projectId: input.projectId,
    itemId: input.itemId,
    qty: input.qty,
    previousUsd: previous === null ? null : String(previous),
    newUsd: String(input.newUsd),
    reasonHe: input.reasonHe,
  });

  return {
    itemId: item.id,
    itemName: item.name,
    qty: input.qty,
    previous,
    next: input.newUsd,
  };
}

/**
 * Who this change matters to, among the suppliers already in conversation.
 *
 * Reads the comparison rather than the raw quotes, so the gaps here are the
 * same gaps shown on the page - one rule for "how far off is this", not two.
 */
export async function suppliersAffectedBy(
  projectId: string,
  change: TargetChange,
): Promise<AffectedSupplier[]> {
  const direction = directionOf(change.previous, change.next);
  if (direction === "unchanged") return [];

  const comparison = await buildComparison(projectId);
  const affected: AffectedSupplier[] = [];

  for (const supplier of comparison.suppliers) {
    /*
     * A refusal is a price opinion without a price. They are the whole reason
     * to raise a target, so they are checked before the priced suppliers and
     * are not skipped for having no lines.
     */
    if (supplier.rejectsTargetPrice && direction === "raised") {
      affected.push({
        supplierId: supplier.supplierId,
        company: supplier.company,
        whyHe: `אמר שמחיר המטרה הקודם לא אפשרי. במחיר החדש כדאי לחזור אליו - הוא כבר מכיר את המוצר`,
        gapBefore: supplier.bestGapPct,
        gapAfter: null,
        refusedOldTarget: true,
      });
      continue;
    }

    const best = supplier.lines
      .filter((line) => line.quotedFob !== null)
      .sort((a, b) => (a.gapPct ?? 0) - (b.gapPct ?? 0))[0];

    if (!best?.quotedFob) continue;

    const gapAfter = ((best.quotedFob - change.next) / change.next) * 100;
    const gapBefore = best.gapPct;

    const wasAcceptable = gapBefore !== null && gapBefore <= ACCEPTABLE_GAP_PCT;
    const isAcceptable = gapAfter <= ACCEPTABLE_GAP_PCT;

    // Only a crossing matters. A supplier who was out of range and still is has
    // nothing new to be told.
    if (wasAcceptable === isAcceptable) continue;

    affected.push({
      supplierId: supplier.supplierId,
      company: supplier.company,
      whyHe: isAcceptable
        ? `ההצעה שלו נכנסה לטווח - ${gapAfter >= 0 ? "+" : ""}${gapAfter.toFixed(0)}% במקום ${gapBefore?.toFixed(0)}%`
        : `ההצעה שלו יצאה מהטווח - ${gapAfter >= 0 ? "+" : ""}${gapAfter.toFixed(0)}% במקום ${gapBefore?.toFixed(0)}%`,
      gapBefore,
      gapAfter,
      refusedOldTarget: false,
    });
  }

  return affected;
}

/** The change history for a project, newest first. */
export async function revisionsFor(projectId: string) {
  return db
    .select({
      itemId: targetRevisions.itemId,
      itemName: items.name,
      qty: targetRevisions.qty,
      previousUsd: targetRevisions.previousUsd,
      newUsd: targetRevisions.newUsd,
      reasonHe: targetRevisions.reasonHe,
      changedAt: targetRevisions.changedAt,
    })
    .from(targetRevisions)
    .leftJoin(items, eq(targetRevisions.itemId, items.id))
    .where(eq(targetRevisions.projectId, projectId))
    .orderBy(targetRevisions.changedAt);
}
