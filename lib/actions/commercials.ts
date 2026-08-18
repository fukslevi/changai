"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, items, projects } from "../db";

export type CommercialsState = { error?: string; ok?: string };

/** Empty means "not answered yet" and must stay null, not become zero. */
function decimal(value: FormDataEntryValue | null): string | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const parsed = Number(text);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return String(parsed);
}

export async function saveCommercials(
  _prev: CommercialsState,
  formData: FormData,
): Promise<CommercialsState> {
  const projectId = String(formData.get("projectId") ?? "");
  if (!projectId) return { error: "Missing project" };

  await db
    .update(projects)
    .set({
      targetRoi: decimal(formData.get("targetRoi")),
      ppcPct: decimal(formData.get("ppcPct")),
      roiAfterPpc: formData.get("roiAfterPpc") === "on",
      referralPct: decimal(formData.get("referralPct")),
      hsCode: String(formData.get("hsCode") ?? "").trim() || null,
      dutyRatePct: decimal(formData.get("dutyRatePct")),
      freightUsdPerCbm: decimal(formData.get("freightUsdPerCbm")),
      inboundUsdPerUnit: decimal(formData.get("inboundUsdPerUnit")),
    })
    .where(eq(projects.id, projectId));

  revalidatePath(`/projects/${projectId}`);
  return { ok: "נשמר" };
}

export async function saveProductCommercials(
  _prev: CommercialsState,
  formData: FormData,
): Promise<CommercialsState> {
  const projectId = String(formData.get("projectId") ?? "");
  const itemId = String(formData.get("itemId") ?? "");
  if (!projectId || !itemId) return { error: "Missing item" };

  await db
    .update(items)
    .set({
      targetRetailUsd: decimal(formData.get("targetRetailUsd")),
      fbaFeeUsd: decimal(formData.get("fbaFeeUsd")),
      assumedCbmPerUnit: decimal(formData.get("assumedCbmPerUnit")),
    })
    .where(eq(items.id, itemId));

  revalidatePath(`/projects/${projectId}`);
  return { ok: "נשמר" };
}
