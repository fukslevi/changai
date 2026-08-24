/**
 * On, off, and filed away - the state changes, without the plumbing.
 *
 * Separated from the server actions because the rules here are the kind worth
 * testing and the actions are not callable outside a request: they revalidate
 * paths, which needs a rendering context. The first version of the test proved
 * only that `revalidatePath` throws in a script.
 *
 * The rules themselves are all about what does not happen - archiving must
 * switch a project off, must not toggle one that is already off, and restoring
 * must not switch anything on - and those are exactly the rules that rot
 * silently, because nothing looks wrong when they break.
 */
import { eq } from "drizzle-orm";
import { db, projects } from "../db";

export type SwitchOutcome =
  | { ok: true; messageHe: string }
  | { ok: false; messageHe: string };

/** Off means off: nothing read, nothing sent, nothing chased, no alerts. */
export async function setPaused(projectId: string, paused: boolean): Promise<SwitchOutcome> {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) return { ok: false, messageHe: "הפרויקט לא נמצא" };

  if (project.archivedAt) {
    return { ok: false, messageHe: "הפרויקט בארכיון. שחזר אותו קודם ואז אפשר להדליק." };
  }

  await db
    .update(projects)
    .set({ pausedAt: paused ? new Date() : null })
    .where(eq(projects.id, projectId));

  return {
    ok: true,
    messageHe: paused
      ? "הפרויקט כבוי. לא נשלחים מיילים, לא נקראות תשובות ולא נשלחות תזכורות עד שתדליק אותו."
      : "הפרויקט פעיל שוב. המחזור הבא ימשיך מאיפה שהפסיק.",
  };
}

/**
 * Filing a project away always leaves it switched off.
 *
 * `pausedAt: project.pausedAt ?? new Date()` is the whole rule: a running
 * project gets switched off, and one that was already off keeps the timestamp
 * it had, so the archive never reads as "switched off just now" for something
 * that stopped last week.
 */
export async function setArchived(
  projectId: string,
  archived: boolean,
): Promise<SwitchOutcome & { wasRunning?: boolean }> {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) return { ok: false, messageHe: "הפרויקט לא נמצא" };

  const wasRunning = !project.pausedAt;

  await db
    .update(projects)
    .set(
      archived
        ? { archivedAt: new Date(), pausedAt: project.pausedAt ?? new Date() }
        : { archivedAt: null },
    )
    .where(eq(projects.id, projectId));

  if (!archived) {
    return {
      ok: true,
      wasRunning,
      messageHe: "הפרויקט שוחזר מהארכיון. הוא עדיין כבוי - הדלק אותו כדי שימשיך לעבוד.",
    };
  }

  return {
    ok: true,
    wasRunning,
    messageHe: wasRunning
      ? "הפרויקט הועבר לארכיון וכובה. שום דבר לא נשלח ולא נקרא. אפשר לשחזר בכל רגע."
      : "הפרויקט הועבר לארכיון. הוא היה כבוי וכך הוא נשאר. אפשר לשחזר בכל רגע.",
  };
}
