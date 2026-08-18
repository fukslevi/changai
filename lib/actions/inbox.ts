"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, messages } from "../db";
import { pollInbox } from "../inbox/run";
import { draftReply, sendReply } from "../inbox/reply";

export type InboxState = { error?: string; ok?: string; draft?: string };

export async function refreshInbox(
  _prev: InboxState,
  formData: FormData,
): Promise<InboxState> {
  const projectId = String(formData.get("projectId") ?? "");
  if (!projectId) return { error: "Missing project" };

  try {
    const result = await pollInbox(projectId);
    revalidatePath(`/projects/${projectId}`);

    if (result.newMessages === 0) {
      return { ok: `נבדקו ${result.threadsChecked} שרשורים - אין תשובות חדשות` };
    }
    return {
      ok:
        `${result.newMessages} תשובות חדשות · ${result.classified} סווגו` +
        (result.needsHuman > 0 ? ` · ${result.needsHuman} דורשות אותך` : ""),
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "הבדיקה נכשלה" };
  }
}

/** Suggest a reply. Returns text for the operator to edit - sends nothing. */
export async function suggestReply(
  _prev: InboxState,
  formData: FormData,
): Promise<InboxState> {
  const projectId = String(formData.get("projectId") ?? "");
  const supplierId = String(formData.get("supplierId") ?? "");
  if (!projectId || !supplierId) return { error: "Missing supplier" };

  try {
    return { draft: await draftReply({ projectId, supplierId }) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "הניסוח נכשל" };
  }
}

export async function replyToSupplier(
  _prev: InboxState,
  formData: FormData,
): Promise<InboxState> {
  const projectId = String(formData.get("projectId") ?? "");
  const supplierId = String(formData.get("supplierId") ?? "");
  const body = String(formData.get("body") ?? "").trim();

  if (!projectId || !supplierId) return { error: "Missing supplier" };
  if (body.length < 10) return { error: "התשובה ריקה" };

  try {
    await sendReply(projectId, supplierId, body);
    revalidatePath(`/projects/${projectId}`);
    return { ok: "התשובה נשלחה" };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "השליחה נכשלה" };
  }
}

/** Mark a reply as dealt with without answering it. */
export async function markHandled(
  _prev: InboxState,
  formData: FormData,
): Promise<InboxState> {
  const projectId = String(formData.get("projectId") ?? "");
  const messageId = String(formData.get("messageId") ?? "");
  if (!projectId || !messageId) return { error: "Missing message" };

  await db.update(messages).set({ handledAt: new Date() }).where(eq(messages.id, messageId));
  revalidatePath(`/projects/${projectId}`);
  return { ok: "סומן כטופל" };
}
