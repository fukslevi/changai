"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, projects } from "../db";
import { loadMandate } from "../negotiate/mandate";

export type AutonomyState = { error?: string; ok?: string };

function money(value: FormDataEntryValue | null): string {
  const parsed = Number(String(value ?? "0").replace(/[^0-9.]/g, ""));
  return Number.isFinite(parsed) && parsed >= 0 ? String(parsed) : "0";
}

export async function saveAutonomy(
  _prev: AutonomyState,
  formData: FormData,
): Promise<AutonomyState> {
  const projectId = String(formData.get("projectId") ?? "");
  if (!projectId) return { error: "Missing project" };

  const tier = Number(formData.get("tier") ?? 1) === 3 ? 3 : 1;
  const rounds = Math.min(12, Math.max(1, Number(formData.get("maxRounds") ?? 4) || 4));

  await db
    .update(projects)
    .set({
      autonomyTier: tier,
      sampleBudgetUsd: money(formData.get("sampleBudgetUsd")),
      maxToolingUsd: money(formData.get("maxToolingUsd")),
      allowSpecSubstitution: formData.get("allowSpecSubstitution") === "on",
      maxNegotiationRounds: rounds,
    })
    .where(eq(projects.id, projectId));

  revalidatePath(`/projects/${projectId}`);

  if (tier === 1) return { ok: "נשמר. המערכת תעצור אצלך בכל מה שנוגע למחיר ולמפרט." };

  // Turning autonomy on without a ceiling is the one combination that reads as
  // enabled and behaves as disabled, so say it here rather than let the run
  // report it later.
  const mandate = await loadMandate(projectId);
  if (mandate.blockedReason) return { error: mandate.blockedReason };

  return { ok: "נשמר. המערכת תנהל את המשא ומתן עד התקרה, ולא מעבר." };
}
