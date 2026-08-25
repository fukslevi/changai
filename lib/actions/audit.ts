"use server";

import { eq } from "drizzle-orm";
import { db, items, projects } from "../db";
import { auditTarget, type AuditInput, type AuditResult } from "../pricing/audit";

export type AuditState = { error?: string; result?: AuditResult };

function number(value: FormDataEntryValue | null, fallback: number): number {
  const cleaned = String(value ?? "").replace(/[^0-9.]/g, "");
  if (!cleaned) return fallback;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Check the target price against what factories actually charge.
 *
 * Read-only. It changes no target, writes to no supplier and records nothing:
 * the point is to find out whether the number we have been defending is
 * defensible, and an audit that quietly acts on its own finding is one nobody
 * would run twice.
 */
export async function runAudit(
  _prev: AuditState,
  formData: FormData,
): Promise<AuditState> {
  const projectId = String(formData.get("projectId") ?? "");
  if (!projectId) return { error: "Missing project" };

  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) return { error: "Project not found" };

  const retailUsd = number(formData.get("retailUsd"), 0);
  if (retailUsd <= 0) return { error: "צריך מחיר מכירה כדי לחשב משהו" };

  const input: AuditInput = {
    retailUsd,
    referralPct: number(formData.get("referralPct"), 15),
    ppcPct: number(formData.get("ppcPct"), 10),
    fbaFeeUsd: number(formData.get("fbaFeeUsd"), 0),
    freightUsdPerUnit: number(formData.get("freightUsdPerUnit"), 0),
    dutyRatePct: number(formData.get("dutyRatePct"), 0),
    targetRoi: number(formData.get("targetRoiPct"), 100) / 100,
  };

  try {
    const result = await auditTarget(projectId, project.name, input);

    /*
     * The retail price and fulfilment fee are kept on the item so the form
     * comes back filled in. Nothing else is stored - the rest are assumptions
     * being tried out, and saving a trial run as though it were a decision is
     * how a spreadsheet becomes a source of truth nobody trusts.
     */
    const [firstItem] = await db
      .select()
      .from(items)
      .where(eq(items.projectId, projectId));

    if (firstItem) {
      await db
        .update(items)
        .set({ targetRetailUsd: String(retailUsd), fbaFeeUsd: String(input.fbaFeeUsd) })
        .where(eq(items.id, firstItem.id));
    }

    return { result };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "הבדיקה נכשלה" };
  }
}
