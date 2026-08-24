"use server";

import { revalidatePath } from "next/cache";
import { db, items, projects } from "../db";
import { eq } from "drizzle-orm";
import {
  directionOf,
  reviseTarget,
  suppliersAffectedBy,
  type AffectedSupplier,
} from "../pricing/revise";

export type TargetState = {
  error?: string;
  ok?: string;
  /** Who the change matters to, for the operator to act on. */
  affected?: AffectedSupplier[];
  direction?: "raised" | "lowered" | "unchanged";
};

function parsePrice(value: FormDataEntryValue | null): number | null {
  const cleaned = String(value ?? "").replace(/[^0-9.]/g, "");
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Change a target price by hand.
 *
 * The RFQ's number is a starting position, not a fact. When three factories
 * independently say it cannot be met, the useful response is to decide what
 * the product is actually worth paying - and the system should let that happen
 * without re-parsing the document or editing a spreadsheet.
 *
 * Returns who the change affects rather than acting on them. Going back to a
 * supplier to say our price moved is a commercial decision with a cost: it
 * tells them we were flexible, which is worth knowing before doing it eleven
 * times at once.
 */
export async function updateTargetPrice(
  _prev: TargetState,
  formData: FormData,
): Promise<TargetState> {
  const projectId = String(formData.get("projectId") ?? "");
  const itemId = String(formData.get("itemId") ?? "");
  if (!projectId || !itemId) return { error: "Missing item" };

  const newUsd = parsePrice(formData.get("newUsd"));
  if (newUsd === null) return { error: "מחיר לא תקין" };

  const rawQty = String(formData.get("qty") ?? "").trim();
  const qty = rawQty === "" || rawQty === "all" ? null : Number(rawQty);
  if (qty !== null && !Number.isFinite(qty)) return { error: "כמות לא תקינה" };

  const reasonHe = String(formData.get("reason") ?? "").trim() || null;

  try {
    const change = await reviseTarget({ projectId, itemId, qty, newUsd, reasonHe });
    const direction = directionOf(change.previous, change.next);
    const affected = await suppliersAffectedBy(projectId, change);

    revalidatePath(`/projects/${projectId}`);

    const scope = qty === null ? "כל מדרגות הכמות" : `כמות ${qty.toLocaleString()}`;
    const from = change.previous === null ? "ללא מחיר" : `$${change.previous.toFixed(2)}`;

    const headline = `${change.itemName} · ${scope}: ${from} ← $${newUsd.toFixed(2)}. התקרה למשא ומתן התעדכנה אוטומטית.`;

    if (affected.length === 0) {
      return { ok: `${headline} אף שיחה קיימת לא מושפעת.`, direction, affected: [] };
    }

    return {
      ok: `${headline} ${affected.length} ספקים שהשינוי נוגע להם - הם למטה, ואף אחד מהם לא קיבל הודעה.`,
      direction,
      affected,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "העדכון נכשל" };
  }
}

/** The priced items of a project, for the edit form. */
export async function pricedItems(projectId: string) {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) return [];

  return db.select().from(items).where(eq(items.projectId, projectId));
}
