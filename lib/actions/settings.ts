"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { saveSettings } from "../settings";

export type SettingsState = { error?: string; ok?: string };

const SettingsInput = z.object({
  senderName: z.string().trim().min(2, "שם השולח חובה"),
  senderTitle: z.string().trim().min(1, "תפקיד חובה"),
  sourcingMailbox: z.email("כתובת מייל לא תקינה"),
  companyName: z.string().trim().min(1, "שם החברה חובה"),
  notifyEmail: z.email("כתובת מייל לא תקינה"),
  maxColdPerDay: z.coerce
    .number()
    .int()
    .min(1, "לפחות פנייה אחת ביום")
    .max(200, "מעל 200 ביום זו כמות שתשרוף את התיבה"),
});

export async function updateSettings(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const parsed = SettingsInput.safeParse({
    senderName: formData.get("senderName"),
    senderTitle: formData.get("senderTitle"),
    sourcingMailbox: formData.get("sourcingMailbox"),
    companyName: formData.get("companyName"),
    notifyEmail: formData.get("notifyEmail"),
    maxColdPerDay: formData.get("maxColdPerDay"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "קלט לא תקין" };
  }

  await saveSettings(parsed.data);
  revalidatePath("/settings");

  return {
    ok: "נשמר. מיילים שכבר נוצרו לא משתנים — לחץ Regenerate בפרויקט כדי לעדכן את החתימה בהם.",
  };
}
