/**
 * What state a project is actually in, for the list page.
 *
 * The stored `status` column says "sourcing" from the moment the project is
 * created until someone changes it by hand, which means it says the same thing
 * whether eleven conversations are running or nothing has ever been sent. What
 * an operator wants from a list of projects is narrower and more useful: is
 * anything moving, and is it waiting on me.
 *
 * Derived on every read rather than stored. A cached status is a status that
 * goes stale exactly when it matters - the moment a supplier replies.
 */
import { inArray } from "drizzle-orm";
import { db, messages, outreach, projects } from "./db";
import { pendingQuestions } from "./questions";

export type Activity = "needs_you" | "running" | "ready_to_send" | "draft" | "stopped";

export interface ProjectStatus {
  id: string;
  autonomous: boolean;
  activity: Activity;
  /** Conversations still open with a supplier. */
  liveThreads: number;
  openQuestions: number;
  /** Approved suppliers not yet written to. */
  waitingToSend: number;
  lastActivity: Date | null;
}

export const ACTIVITY_LABEL: Record<Activity, string> = {
  needs_you: "ממתין לך",
  running: "פעיל",
  ready_to_send: "מוכן לשליחה",
  draft: "טיוטה",
  stopped: "עצר",
};

/**
 * Three states an operator scanning a list actually acts on: green means it is
 * moving without you, amber means it stopped and you are the reason, red means
 * it stopped and will not restart by itself. Blue and grey are the two that
 * have not begun yet.
 */
export const ACTIVITY_COLOUR: Record<Activity, string> = {
  needs_you: "var(--warn)",
  running: "var(--ok)",
  ready_to_send: "var(--accent)",
  draft: "var(--muted)",
  stopped: "var(--bad)",
};

export const ACTIVITY_DOT: Record<Activity, string> = ACTIVITY_COLOUR;

export const ACTIVITY_HINT: Record<Activity, string> = {
  needs_you: "עצר עד שתענה על שאלה פתוחה",
  running: "רץ לבד - שיחות פתוחות, אין חסימה",
  ready_to_send: "יש RFQ, טרם נשלח לספקים",
  draft: "עוד לא הועלה RFQ",
  stopped: "אין שיחה חיה ואין מה לשלוח - לא ימשיך מעצמו",
};

/**
 * One pass over every project, rather than a query per row.
 *
 * The list is short today and the difference does not show, but a per-row query
 * on a page that renders a list is the kind of thing that is invisible until
 * there are thirty projects and then is the whole page load.
 */
export async function projectStatuses(
  rows: (typeof projects.$inferSelect)[],
): Promise<Map<string, ProjectStatus>> {
  const ids = rows.map((r) => r.id);
  const out = new Map<string, ProjectStatus>();
  if (ids.length === 0) return out;

  const [outreachRows, messageRows] = await Promise.all([
    db
      .select({
        projectId: outreach.projectId,
        supplierId: outreach.supplierId,
        status: outreach.status,
      })
      .from(outreach)
      .where(inArray(outreach.projectId, ids)),
    db
      .select({ projectId: messages.projectId, receivedAt: messages.receivedAt })
      .from(messages)
      .where(inArray(messages.projectId, ids)),
  ]);

  for (const project of rows) {
    const sent = outreachRows.filter((o) => o.projectId === project.id);
    const live = sent.filter((o) => o.status === "sent" || o.status === "replied").length;

    const lastActivity = messageRows
      .filter((m) => m.projectId === project.id)
      .map((m) => m.receivedAt)
      .sort((a, b) => b.getTime() - a.getTime())[0];

    // Commercial gaps are derived, so the count comes from the same place the
    // project page uses rather than from a second, divergent rule.
    const { open } = await pendingQuestions(project.id);
    const questions = open.length;

    let activity: Activity;
    if (questions > 0) activity = "needs_you";
    else if (live > 0) activity = "running";
    else if (sent.length === 0 && project.sourceRfqFile) activity = "ready_to_send";
    else if (sent.length === 0) activity = "draft";
    else activity = "stopped";

    out.set(project.id, {
      id: project.id,
      autonomous: project.autonomyTier >= 3,
      activity,
      liveThreads: live,
      openQuestions: questions,
      waitingToSend: 0,
      lastActivity: lastActivity ?? null,
    });
  }

  return out;
}
