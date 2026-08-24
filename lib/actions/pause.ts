"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, projects, supplierLeads } from "../db";
import { clearNotifications } from "../notify/dispatch";
import { setArchived, setPaused } from "../projects/switches";

export type PauseState = { error?: string; ok?: string };

/**
 * Switch a project off, and back on.
 *
 * Deliberately not the same thing as turning autonomy off. Autonomy off means
 * the project keeps running and the decisions come back to a person; paused
 * means nothing happens at all - no mail read, none sent, no supplier chased,
 * no alerts. The two were one setting for a while and it was the wrong shape:
 * an operator who wants to stop a product entirely was being offered "I will
 * ask you about every reply instead", which is more work rather than none.
 *
 * The rule itself lives in lib/projects/switches so it can be tested without a
 * request context; this is the wrapper that redraws the pages.
 */
export async function toggleProjectPaused(
  _prev: PauseState,
  formData: FormData,
): Promise<PauseState> {
  const projectId = String(formData.get("projectId") ?? "");
  if (!projectId) return { error: "Missing project" };

  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) return { error: "Project not found" };

  const paused = Boolean(project.pausedAt);
  const outcome = await setPaused(projectId, !paused);
  if (!outcome.ok) return { error: outcome.messageHe };

  /*
   * Restarting clears the completion notice. A project that is switched back
   * on can finish again, and the second finish is news; without this the
   * dedupe key from the first one silences it forever.
   */
  if (paused) await clearNotifications(projectId, ["project_done"]);

  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/");

  return { ok: outcome.messageHe };
}

/**
 * File a project away, or take it back out.
 *
 * Archiving switches it off too, always. A project sitting in an archive while
 * still chasing factories is the worst of both: out of sight, and writing to
 * people in your name. If it was already off it stays off, which is the same
 * end state by a shorter route.
 *
 * Restoring does not switch it back on. Bringing something back to look at it
 * is not the same as deciding to resume it, and a restore that quietly starts
 * sending is a restore nobody will risk using.
 */
export async function toggleProjectArchived(
  _prev: PauseState,
  formData: FormData,
): Promise<PauseState> {
  const projectId = String(formData.get("projectId") ?? "");
  if (!projectId) return { error: "Missing project" };

  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) return { error: "Project not found" };

  const outcome = await setArchived(projectId, !project.archivedAt);
  if (!outcome.ok) return { error: outcome.messageHe };

  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/");

  return { ok: outcome.messageHe };
}

/**
 * Hand a conversation back to the agent.
 *
 * The counterpart to taking one over. Without it, one manual reply retires the
 * thread permanently, which is a heavy price for answering a single question
 * yourself.
 */
export async function releaseSupplier(
  _prev: PauseState,
  formData: FormData,
): Promise<PauseState> {
  const projectId = String(formData.get("projectId") ?? "");
  const supplierId = String(formData.get("supplierId") ?? "");
  if (!projectId || !supplierId) return { error: "Missing supplier" };

  await db
    .update(supplierLeads)
    .set({ takenOverAt: null })
    .where(
      and(eq(supplierLeads.projectId, projectId), eq(supplierLeads.supplierId, supplierId)),
    );

  revalidatePath(`/projects/${projectId}`);
  return { ok: "השיחה חזרה לסוכן. הוא ימשיך אותה במחזור הבא." };
}
