"use server";

import { revalidatePath } from "next/cache";
import { importNewProducts } from "../intake/import";
import { parseSheetUrl } from "../intake/sheet";
import { setProductIntakeSheetUrl } from "../settings";

export type IntakeState = { error?: string; ok?: string };

export async function updateIntakeSheetUrl(
  _prev: IntakeState,
  formData: FormData,
): Promise<IntakeState> {
  const url = String(formData.get("sheetUrl") ?? "").trim();
  if (!url) return { error: "צריך כתובת גיליון" };
  if (!parseSheetUrl(url)) return { error: "כתובת גיליון לא תקינה" };

  await setProductIntakeSheetUrl(url);
  revalidatePath("/settings");
  return { ok: "נשמר. הבדיקה הבאה תרוץ בתוך 24 שעות, או לחץ \"בדוק עכשיו\"." };
}

export async function runIntakeNow(
  _prev: IntakeState,
  _formData: FormData,
): Promise<IntakeState> {
  try {
    const result = await importNewProducts();
    revalidatePath("/settings");
    revalidatePath("/");

    if (result.created.length === 0 && result.skipped.length === 0) {
      return { ok: "אין שורות חדשות בגיליון" };
    }

    const parts: string[] = [];
    if (result.created.length > 0) {
      parts.push(`נוצרו ${result.created.length} פרויקטים: ${result.created.map((c) => c.name).join(", ")}`);
    }
    if (result.skipped.length > 0) {
      parts.push(
        `דולגו ${result.skipped.length}: ${result.skipped.map((s) => `שורה ${s.row} (${s.reason})`).join(", ")}`,
      );
    }
    return { ok: parts.join(" · ") };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "הבדיקה נכשלה" };
  }
}
