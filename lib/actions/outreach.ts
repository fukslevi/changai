"use server";

import { asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, items, projects, requirements } from "../db";
import { clearFailed, sendNext } from "../outreach/batch";
import { CAMPAIGN_CONFIRMATION } from "../outreach/confirm";
import { buildOutreachEmail } from "../outreach/template";
import { getSettings } from "../settings";

export type OutreachState = { error?: string; ok?: string };

/** Settings page value first, .env as the fallback. */
async function sender() {
  const s = await getSettings();
  return { name: s.senderName, title: s.senderTitle };
}

/** Rebuild from the parsed RFQ, discarding any manual edits. */
export async function generateOutreachEmail(
  _prev: OutreachState,
  formData: FormData,
): Promise<OutreachState> {
  const projectId = String(formData.get("projectId") ?? "");
  if (!projectId) return { error: "Missing project" };

  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) return { error: "Project not found" };

  const [projectItems, projectRequirements] = await Promise.all([
    db.select().from(items).where(eq(items.projectId, projectId)).orderBy(asc(items.name)),
    db.select().from(requirements).where(eq(requirements.projectId, projectId)),
  ]);

  if (projectItems.length === 0) {
    return { error: "Parse the RFQ first - the email is built from it" };
  }

  const { subject, body } = buildOutreachEmail(
    project,
    projectItems,
    projectRequirements,
    await sender(),
  );

  await db
    .update(projects)
    .set({ outreachSubject: subject, outreachBody: body })
    .where(eq(projects.id, projectId));

  revalidatePath(`/projects/${projectId}`);
  return { ok: "Email regenerated from the RFQ" };
}

export interface CampaignSendResult {
  error?: string;
  /** Set when a message actually left the building. */
  sentTo?: string;
  failedFor?: string;
  remaining: number;
  done: boolean;
}

/**
 * Send to the next supplier on the list, and only that one.
 *
 * The client drives the loop with a delay between calls. Keeping one send per
 * request means the pace is visible and interruptible: closing the page stops
 * the campaign, and what already went out is exactly what the table shows.
 * A loop inside one long request would give neither.
 */
export async function sendNextOutreach(
  projectId: string,
  confirmation: string,
): Promise<CampaignSendResult> {
  if (!projectId) return { error: "Missing project", remaining: 0, done: true };

  /*
   * The typed phrase exists so a first send is a deliberate act rather than a
   * misplaced click. On an autonomous project that act already happened - it
   * was the decision to turn autonomy on - and asking again turns the whole
   * mode into a button that says "automatic" and then waits.
   *
   * The gates that matter are unchanged either way: a walk-away price must
   * exist, only approved suppliers are written to, and nobody is written to
   * twice.
   */
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  const autonomous = (project?.autonomyTier ?? 1) >= 3;

  if (!autonomous && confirmation !== CAMPAIGN_CONFIRMATION) {
    return { error: "השליחה לא אושרה", remaining: 0, done: true };
  }

  try {
    const outcome = await sendNext(projectId);
    if (!outcome) {
      revalidatePath(`/projects/${projectId}`);
      return { remaining: 0, done: true };
    }

    revalidatePath(`/projects/${projectId}`);
    return {
      sentTo: outcome.ok ? outcome.recipient.companyName : undefined,
      failedFor: outcome.ok ? undefined : outcome.recipient.companyName,
      error: outcome.error,
      remaining: outcome.remaining,
      done: outcome.remaining === 0,
    };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : "השליחה נכשלה",
      remaining: 0,
      done: true,
    };
  }
}

/** Put failed sends back on the pending list. */
export async function retryFailedOutreach(
  _prev: OutreachState,
  formData: FormData,
): Promise<OutreachState> {
  const projectId = String(formData.get("projectId") ?? "");
  if (!projectId) return { error: "Missing project" };

  const cleared = await clearFailed(projectId);
  revalidatePath(`/projects/${projectId}`);
  return { ok: `${cleared} נשלחים חזרו לרשימה` };
}

/** Save the operator's edits. This text is what actually sends. */
export async function saveOutreachEmail(
  _prev: OutreachState,
  formData: FormData,
): Promise<OutreachState> {
  const projectId = String(formData.get("projectId") ?? "");
  const subject = String(formData.get("subject") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();

  if (!projectId) return { error: "Missing project" };
  if (!subject) return { error: "Subject is required" };
  if (!body) return { error: "Body is required" };

  await db
    .update(projects)
    .set({ outreachSubject: subject, outreachBody: body })
    .where(eq(projects.id, projectId));

  revalidatePath(`/projects/${projectId}`);
  return { ok: "Saved" };
}
