"use server";

import { and, asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, items, messages, openQuestions, suppliers } from "../db";
import { planReply, runAutopilot } from "../inbox/autopilot";

export type AutopilotState = {
  error?: string;
  ok?: string;
  /** What it would do, when previewing. */
  preview?: {
    company: string;
    action: "reply" | "park" | "hold";
    detail: string;
  }[];
};

/**
 * Show what the autopilot would do without sending anything.
 *
 * Worth having as its own button: the first time a system answers suppliers on
 * its own, the operator should be able to read the actual words before they go
 * to a factory, not after.
 */
export async function previewAutopilot(
  _prev: AutopilotState,
  formData: FormData,
): Promise<AutopilotState> {
  const projectId = String(formData.get("projectId") ?? "");
  if (!projectId) return { error: "Missing project" };

  try {
    const pending = await db
      .select({
        id: messages.id,
        supplierId: messages.supplierId,
        company: suppliers.companyName,
        analysis: messages.analysis,
        classification: messages.classification,
        handledAt: messages.handledAt,
      })
      .from(messages)
      .leftJoin(suppliers, eq(messages.supplierId, suppliers.id))
      .where(and(eq(messages.projectId, projectId), eq(messages.direction, "inbound")))
      .orderBy(asc(messages.receivedAt));

    const preview: NonNullable<AutopilotState["preview"]> = [];

    for (const message of pending) {
      if (!message.supplierId || message.handledAt) continue;
      const company = message.company ?? "ספק";

      if (message.classification === "not_relevant") continue;

      if (
        message.analysis?.challenges_a_requirement === true ||
        message.classification === "quotation"
      ) {
        preview.push({
          company,
          action: "hold",
          detail: message.analysis?.needs_human_reason ?? "דורש החלטה שלך",
        });
        continue;
      }

      const plan = await planReply({ projectId, supplierId: message.supplierId });
      preview.push(
        plan.answerable
          ? { company, action: "reply", detail: plan.draft }
          : {
              company,
              action: "park",
              detail: plan.open_questions.map((q) => q.question_he).join("\n"),
            },
      );
    }

    if (preview.length === 0) {
      return {
        ok: "אין שיחה שממתינה לתשובה שלנו - כל מה שהגיע כבר טופל. הכפתור יראה משהו כשספק יענה.",
      };
    }
    return { preview, ok: `${preview.length} שיחות נבדקו. לא נשלח דבר.` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "הבדיקה נכשלה" };
  }
}

/** Reply where possible, park the rest. This one sends. */
export async function runAutopilotAction(
  _prev: AutopilotState,
  formData: FormData,
): Promise<AutopilotState> {
  const projectId = String(formData.get("projectId") ?? "");
  if (!projectId) return { error: "Missing project" };

  try {
    const result = await runAutopilot(projectId);
    revalidatePath(`/projects/${projectId}`);

    const parts = [
      result.replied.length > 0 ? `${result.replied.length} נענו אוטומטית` : "",
      result.parked.length > 0 ? `${result.parked.length} ממתינים לתשובה שלך` : "",
      result.heldForHuman.length > 0 ? `${result.heldForHuman.length} דורשים החלטה` : "",
      result.waitingOnAnswers.length > 0
        ? `${result.waitingOnAnswers.length} כבר ממתינים בתור`
        : "",
    ].filter(Boolean);

    return { ok: parts.join(" · ") || "אין שיחות פתוחות" };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "ההרצה נכשלה" };
  }
}

/**
 * Answer a parked question, then let every thread it was blocking proceed.
 *
 * The answer is stored against the project, not the supplier who asked, so the
 * next factory that raises the same point is answered without anyone noticing
 * it was ever a question.
 */
export async function answerQuestion(
  _prev: AutopilotState,
  formData: FormData,
): Promise<AutopilotState> {
  const projectId = String(formData.get("projectId") ?? "");
  const questionId = String(formData.get("questionId") ?? "");
  const answer = String(formData.get("answer") ?? "").trim();
  const alsoSend = formData.get("alsoSend") === "on";

  if (!projectId || !questionId) return { error: "Missing question" };
  if (!answer) return { error: "התשובה ריקה" };

  /*
   * A commercial gap is a synthetic question - its id encodes which field it
   * fills. Answering writes the number and the question disappears because the
   * field is no longer empty, so there is no stored row to keep in step.
   */
  if (questionId.startsWith("commercial:")) {
    const [, itemId, field] = questionId.split(":");
    const allowed = ["targetRetailUsd", "fbaFeeUsd", "assumedCbmPerUnit"];
    if (!itemId || !field || !allowed.includes(field)) return { error: "שאלה לא מוכרת" };

    const value = Number(answer.replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(value) || value <= 0) return { error: "צריך מספר חיובי" };

    await db
      .update(items)
      .set({ [field]: String(value) })
      .where(eq(items.id, itemId));

    revalidatePath(`/projects/${projectId}`);
    return { ok: "נשמר" };
  }

  await db
    .update(openQuestions)
    .set({ answer, answeredAt: new Date(), status: "answered" })
    .where(eq(openQuestions.id, questionId));

  if (!alsoSend) {
    revalidatePath(`/projects/${projectId}`);
    return { ok: "נשמר. השיחה תמשיך בהרצה הבאה." };
  }

  try {
    const result = await runAutopilot(projectId);
    revalidatePath(`/projects/${projectId}`);
    return {
      ok:
        result.replied.length > 0
          ? `נשמר · ${result.replied.length} תשובות יצאו לספקים`
          : "נשמר. עדיין אין שיחה שאפשר להשלים.",
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "השליחה נכשלה" };
  }
}

/** A question that turned out not to matter. */
export async function dismissQuestion(
  _prev: AutopilotState,
  formData: FormData,
): Promise<AutopilotState> {
  const projectId = String(formData.get("projectId") ?? "");
  const questionId = String(formData.get("questionId") ?? "");
  if (!projectId || !questionId) return { error: "Missing question" };
  if (questionId.startsWith("commercial:")) {
    return { error: "נתון כלכלי חובה - אי אפשר לבטל אותו" };
  }

  await db
    .update(openQuestions)
    .set({ status: "dismissed", answeredAt: new Date() })
    .where(eq(openQuestions.id, questionId));

  revalidatePath(`/projects/${projectId}`);
  return { ok: "בוטל" };
}
