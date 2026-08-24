/**
 * Telling the operator, without telling them twice.
 *
 * The whole point of an autonomous project is that nobody watches it. That only
 * works if the two moments where watching would have mattered come and find
 * you: a question the agent is not allowed to answer, and a project that has
 * finished. Everything else it handles by itself and there is nothing to say.
 *
 * The cycle runs every two hours, so the hard part is not sending - it is not
 * sending. An alert that repeats until it is acted on trains you to ignore it,
 * and an ignored alert is worse than none, because you believe you are covered.
 * So every announcement is keyed to the specific thing it is about - this
 * question, this project's completion - and a key that has been sent once is
 * never sent again.
 */
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { db, messages, notifications, projects, settings, supplierLeads, suppliers } from "../db";
import { sendEmail } from "../mail/gmail";
import { loadMandate } from "../negotiate/mandate";
import { projectStatuses } from "../project-status";
import { pendingQuestions } from "../questions";
import { buildComparison } from "../quotes/compare";

/** Where the app lives, for the links in the mail. */
const APP_URL = process.env.APP_URL ?? "https://changai-gilt.vercel.app";

const DEFAULT_RECIPIENT = "ori@sosimple.co.il";

export type NotificationKind = "open_questions" | "project_done";

export interface Announcement {
  project: string;
  kind: NotificationKind;
  subject: string;
  /** Carried so a dry run can show exactly what would land in the inbox. */
  body: string;
  keys: string[];
}

export async function notificationRecipient(): Promise<string> {
  const [row] = await db.select().from(settings).where(eq(settings.id, "default"));
  return row?.notifyEmail?.trim() || DEFAULT_RECIPIENT;
}

/** Keys already announced for a project, so nothing repeats. */
async function alreadySent(projectId: string, kind: NotificationKind): Promise<Set<string>> {
  const rows = await db
    .select({ key: notifications.dedupeKey })
    .from(notifications)
    .where(and(eq(notifications.projectId, projectId), eq(notifications.kind, kind)));
  return new Set(rows.map((r) => r.key));
}

async function record(projectId: string, kind: NotificationKind, keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await db
    .insert(notifications)
    .values(keys.map((dedupeKey) => ({ projectId, kind, dedupeKey })))
    .onConflictDoNothing();
}

function link(projectId: string): string {
  return `${APP_URL}/projects/${projectId}`;
}

/**
 * Threads the agent is not allowed to answer.
 *
 * Same rule the project page uses. Two rules for "who can answer this" would
 * eventually disagree, and the day they did, an email would arrive about a
 * thread the agent had already dealt with.
 */
async function heldThreads(projectId: string) {
  const mandate = await loadMandate(projectId);
  if (mandate.mayNegotiatePrice) return [];

  // A thread the operator took over is already theirs; mailing them about it
  // would be the system asking them to do what they said they would do.
  const claimed = new Set(
    (
      await db
        .select({ supplierId: supplierLeads.supplierId })
        .from(supplierLeads)
        .where(
          and(eq(supplierLeads.projectId, projectId), isNotNull(supplierLeads.takenOverAt)),
        )
    ).map((row) => row.supplierId),
  );

  const rows = await db
    .select({
      id: messages.id,
      supplierId: messages.supplierId,
      company: suppliers.companyName,
      subject: messages.subject,
      classification: messages.classification,
      analysis: messages.analysis,
    })
    .from(messages)
    .leftJoin(suppliers, eq(messages.supplierId, suppliers.id))
    .where(
      and(
        eq(messages.projectId, projectId),
        eq(messages.direction, "inbound"),
        isNull(messages.handledAt),
      ),
    );

  return rows.filter((row) => {
    if (row.supplierId && claimed.has(row.supplierId)) return false;
    const analysis = row.analysis as { challenges_a_requirement?: boolean } | null;
    return analysis?.challenges_a_requirement === true || row.classification === "quotation";
  });
}

/**
 * "Someone is waiting on you", in the language the operator works in.
 *
 * Written so it can be acted on from a phone without opening anything: the
 * question itself is in the body, not a promise that it is in the app.
 */
function questionsBody(
  projectName: string,
  items: { company: string | null; text: string; why: string | null }[],
  projectId: string,
): string {
  const lines = items.map((question, i) => {
    const who = question.company ? ` (${question.company})` : "";
    const why = question.why ? `\n   למה זה חוסם: ${question.why}` : "";
    return `${i + 1}. ${question.text}${who}${why}`;
  });

  return `הפרויקט "${projectName}" ממתין לתשובה שלך.

${lines.join("\n\n")}

לענות כאן: ${link(projectId)}

עד שתענה, הסוכן ממשיך לטפל בכל שאר הספקים בפרויקט - רק השיחות שלמעלה מחכות.`;
}

/**
 * "It is finished", with the answer in the mail.
 *
 * The reason to open the app after a project ends is the comparison table, so
 * the top of it travels with the message. If the best supplier is already
 * within reach, that is the entire result and it should not require a click.
 */
async function doneBody(projectName: string, projectId: string, summary: string): Promise<string> {
  const comparison = await buildComparison(projectId);

  const priced = comparison.suppliers
    .filter((supplier) => supplier.bestGapPct !== null)
    .slice(0, 5)
    .map((supplier) => {
      const best = supplier.lines
        .filter((line) => line.quotedFob !== null)
        .sort((a, b) => (a.gapPct ?? 0) - (b.gapPct ?? 0))[0];
      const price = best?.quotedFob != null ? `$${best.quotedFob.toFixed(2)}` : "-";
      const gap =
        supplier.bestGapPct === null
          ? "-"
          : `${supplier.bestGapPct >= 0 ? "+" : ""}${supplier.bestGapPct.toFixed(0)}%`;
      return `- ${supplier.company}: ${price} ליחידה, פער ${gap} ממחיר המטרה`;
    });

  const table =
    priced.length > 0
      ? `\n\nההצעות הטובות ביותר:\n${priced.join("\n")}`
      : "\n\nאף ספק לא מסר מחיר.";

  const refusals =
    comparison.refusals > 0
      ? `\n\n${comparison.refusals} ספקים אמרו שמחיר המטרה לא בר-השגה. כשכולם אומרים את זה, זו אמירה על המחיר ולא על הספקים.`
      : "";

  return `הפרויקט "${projectName}" הסתיים.

${summary}${table}${refusals}

הטבלה המלאה: ${link(projectId)}`;
}

/**
 * Send whatever has not been sent, for every live project.
 *
 * Paused and archived projects are skipped along with everything else about
 * them - a project that is switched off should not be able to email you, and
 * one you have filed away least of all.
 */
export async function dispatchNotifications(
  options: { send?: boolean } = {},
): Promise<Announcement[]> {
  const send = options.send ?? true;
  const to = await notificationRecipient();
  if (!to) return [];

  const live = (await db.select().from(projects)).filter(
    (project) => !project.pausedAt && !project.archivedAt,
  );
  if (live.length === 0) return [];

  const statuses = await projectStatuses(live);
  const out: Announcement[] = [];

  for (const project of live) {
    const status = statuses.get(project.id);
    if (!status) continue;

    if (status.activity === "needs_you") {
      const [{ open }, held, sent] = await Promise.all([
        pendingQuestions(project.id),
        heldThreads(project.id),
        alreadySent(project.id, "open_questions"),
      ]);

      const fresh = [
        ...open
          .filter((question) => !sent.has(question.id))
          .map((question) => ({
            key: question.id,
            company: question.company,
            text: question.questionHe,
            why: question.whyHe,
          })),
        ...held
          .filter((message) => !sent.has(message.id))
          .map((message) => ({
            key: message.id,
            company: message.company,
            text: `הודעה מהספק שרק אתה יכול לענות עליה: ${message.subject ?? "ללא נושא"}`,
            why: "הסוכן לא מורשה לנהל משא ומתן על מחיר בפרויקט הזה",
          })),
      ];

      if (fresh.length === 0) continue;

      const subject =
        fresh.length === 1
          ? `שאלה פתוחה · ${project.name}`
          : `${fresh.length} שאלות פתוחות · ${project.name}`;

      const body = questionsBody(project.name, fresh, project.id);

      if (send) {
        await sendEmail({ to, subject, body, fromName: "ChangAI" });
        await record(
          project.id,
          "open_questions",
          fresh.map((item) => item.key),
        );
      }

      out.push({
        project: project.name,
        kind: "open_questions",
        subject,
        body,
        keys: fresh.map((item) => item.key),
      });
      continue;
    }

    if (status.activity === "done") {
      const sent = await alreadySent(project.id, "project_done");
      // One key per project: a project finishes once. Announcing it again
      // because a straggler replied afterwards would undo the word.
      if (sent.has("done")) continue;

      const subject = `הסתיים · ${project.name}`;
      const body = await doneBody(project.name, project.id, status.nextAction ?? "");

      if (send) {
        await sendEmail({ to, subject, body, fromName: "ChangAI" });
        await record(project.id, "project_done", ["done"]);
      }

      out.push({ project: project.name, kind: "project_done", subject, body, keys: ["done"] });
    }
  }

  return out;
}

/**
 * Forget what was announced for a project.
 *
 * Used when a project is switched back on, so its next completion is news
 * again rather than something that already happened once.
 */
export async function clearNotifications(
  projectId: string,
  kinds?: NotificationKind[],
): Promise<void> {
  await db
    .delete(notifications)
    .where(
      kinds && kinds.length > 0
        ? and(eq(notifications.projectId, projectId), inArray(notifications.kind, kinds))
        : eq(notifications.projectId, projectId),
    );
}
