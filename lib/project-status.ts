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
import { inArray, sql } from "drizzle-orm";
import { db, messages, outreach, projects, supplierLeads } from "./db";
import { loadMandate } from "./negotiate/mandate";
import { pendingQuestions } from "./questions";

export type Activity =
  | "needs_you"
  | "running"
  | "ready_to_send"
  | "draft"
  | "done"
  | "stopped"
  | "paused"
  | "archived";

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
  /** One line saying what happens next without anyone doing anything. */
  nextAction: string | null;
}

export const ACTIVITY_LABEL: Record<Activity, string> = {
  needs_you: "ממתין לך",
  running: "פעיל",
  ready_to_send: "מוכן לשליחה",
  draft: "טיוטה",
  done: "הסתיים",
  stopped: "עצר",
  paused: "כבוי",
  archived: "בארכיון",
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
  done: "var(--ok)",
  stopped: "var(--bad)",
  paused: "var(--muted)",
  archived: "var(--muted)",
};

export const ACTIVITY_DOT: Record<Activity, string> = ACTIVITY_COLOUR;

export const ACTIVITY_HINT: Record<Activity, string> = {
  needs_you: "עצר עד שתענה על שאלה פתוחה",
  running: "רץ לבד - שיחות פתוחות, אין חסימה",
  ready_to_send: "יש RFQ, טרם נשלח לספקים",
  draft: "עוד לא הועלה RFQ",
  done: "כולם קיבלו פנייה, כל מי שהתכוון לענות ענה, ההצעות בטבלה",
  stopped: "אין שיחה חיה ואין מה לשלוח - לא ימשיך מעצמו",
  paused: "כיבית את הפרויקט - שום דבר לא רץ עד שתדליק אותו",
  archived: "בארכיון וכבוי. אפשר לשחזר בכל רגע - שום דבר לא נמחק",
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

  const [outreachRows, messageRows, leadRows] = await Promise.all([
    db
      .select({
        projectId: outreach.projectId,
        supplierId: outreach.supplierId,
        status: outreach.status,
      })
      .from(outreach)
      .where(inArray(outreach.projectId, ids)),
    db
      .select({
        projectId: messages.projectId,
        supplierId: messages.supplierId,
        direction: messages.direction,
        receivedAt: messages.receivedAt,
        handledAt: messages.handledAt,
        classification: messages.classification,
        challenges: sql<boolean>`(${messages.analysis} ->> 'challenges_a_requirement')::boolean`,
      })
      .from(messages)
      .where(inArray(messages.projectId, ids)),
    db
      .select({
        projectId: supplierLeads.projectId,
        supplierId: supplierLeads.supplierId,
        status: supplierLeads.status,
        email: supplierLeads.email,
        takenOverAt: supplierLeads.takenOverAt,
      })
      .from(supplierLeads)
      .where(inArray(supplierLeads.projectId, ids)),
  ]);

  for (const project of rows) {
    /*
     * Off means off. Deriving a status for a paused project would describe
     * work that is not happening - "11 conversations open" on something that
     * has not sent an email since March.
     */
    if (project.pausedAt || project.archivedAt) {
      out.set(project.id, {
        id: project.id,
        autonomous: project.autonomyTier >= 3,
        activity: project.archivedAt ? "archived" : "paused",
        liveThreads: 0,
        openQuestions: 0,
        waitingToSend: 0,
        lastActivity: null,
        nextAction: project.archivedAt
          ? "בארכיון - שום דבר לא רץ. שחזור מחזיר אותו לרשימה, עדיין כבוי"
          : "כבוי - לא נשלח ולא נקרא כלום עד שתדליק",
      });
      continue;
    }

    const sent = outreachRows.filter((o) => o.projectId === project.id);
    const live = sent.filter((o) => o.status === "sent" || o.status === "replied").length;

    const lastActivity = messageRows
      .filter((m) => m.projectId === project.id)
      .map((m) => m.receivedAt)
      .sort((a, b) => b.getTime() - a.getTime())[0];

    /*
     * Counted from inbound messages rather than from the outreach status.
     * The status column is a summary that can fall behind - a reply on a thread
     * the supplier opened used to leave it stale - and the messages are what
     * actually arrived.
     */
    const repliedCount = new Set(
      messageRows
        .filter((m) => m.projectId === project.id && m.direction === "inbound" && m.supplierId)
        .map((m) => m.supplierId),
    ).size;

    // Commercial gaps are derived, so the count comes from the same place the
    // project page uses rather than from a second, divergent rule.
    const { open } = await pendingQuestions(project.id);

    /*
     * Threads only a person can move count as waiting too. They were visible
     * inside the project and invisible from the list, which is the wrong way
     * round: the list is where you decide whether to open the project at all.
     */
    /*
     * A conversation the operator took over is theirs by their own decision,
     * so it is not the agent waiting on them - counting it would leave the
     * project amber forever, and an amber that never clears is a colour that
     * stops meaning anything.
     */
    const claimed = new Set(
      leadRows
        .filter((l) => l.projectId === project.id && l.takenOverAt && l.supplierId)
        .map((l) => l.supplierId),
    );

    const mandate = await loadMandate(project.id);
    const held = mandate.mayNegotiatePrice
      ? 0
      : messageRows.filter(
          (m) =>
            m.projectId === project.id &&
            m.direction === "inbound" &&
            !m.handledAt &&
            !claimed.has(m.supplierId) &&
            (m.challenges === true || m.classification === "quotation"),
        ).length;

    const questions = open.length + held;

    /*
     * A conversation where they spoke last is one we still owe a reply, and a
     * thread closed after two unanswered follow-ups is one that will not
     * produce anything more.
     */
    const awaitingUs = messageRows.filter(
      (m) => m.projectId === project.id && m.direction === "inbound" && !m.handledAt,
    ).length;
    const chasedOut = sent.filter((o) => o.status === "failed").length;

    /*
     * Waiting to send means approved, addressed, and not written to yet.
     *
     * The last clause was missing, and a lead whose status stayed "approved"
     * after its email went out was counted as still waiting. Two of those on
     * Telescopic Ladder produced a permanent "sending first contact to 2
     * suppliers in the coming cycles" on a project with nothing left to send -
     * a promise the page repeated every reload and the cycle never kept.
     *
     * Counted the same way the campaign counts it: an outreach row means the
     * supplier has been contacted, whatever the lead row says.
     */
    const contacted = new Set(
      outreachRows.filter((o) => o.projectId === project.id).map((o) => o.supplierId),
    );

    const approved = leadRows.filter(
      (l) =>
        l.projectId === project.id &&
        l.status === "approved" &&
        l.email &&
        (!l.supplierId || !contacted.has(l.supplierId)),
    ).length;
    const autonomous = project.autonomyTier >= 3;

    /*
     * "Ready to send" describes a project waiting for a person to press send.
     * On an autonomous project nobody is waiting - the next cycle sends - so
     * calling it "ready" reads as stalled when it is working. The distinction
     * is who the next move belongs to, not what stage the project is at.
     */
    let activity: Activity;
    let nextAction: string | null = null;

    if (questions > 0) {
      activity = "needs_you";
      nextAction =
        held > 0 && open.length > 0
          ? `${open.length} שאלות פתוחות · ${held} שיחות שרק אתה יכול לענות עליהן`
          : held > 0
            ? `${held} שיחות שרק אתה יכול לענות עליהן`
            : `${open.length} שאלות ממתינות לתשובה שלך`;
    } else if (autonomous && approved > 0) {
      activity = "running";
      nextAction = `שולח פנייה ראשונה ל-${approved} ספקים במחזורים הקרובים`;
    } else if (live > 0 && awaitingUs === 0 && chasedOut === live - repliedCount && repliedCount > 0) {
      /*
       * Finished means the work stopped for a reason rather than by accident:
       * everyone was contacted, everyone who was going to answer has, the
       * silent ones have had their follow-ups, and nothing is waiting on us.
       * Without this the last state a project reaches is "active", forever.
       */
      activity = "done";
      nextAction = `הסתיים · ${repliedCount} מתוך ${live} ענו · ההצעות בטבלת ההשוואה`;
    } else if (live > 0) {
      activity = "running";
      /*
       * A stage that finishes should say so. "12 conversations open" reads the
       * same on the day the last email went out and three weeks later when
       * everyone has answered - and the difference is the whole question of
       * whether this project still needs watching.
       */
      const awaitingThem = live - repliedCount;
      nextAction = autonomous
        ? awaitingThem > 0
          ? `כל הספקים קיבלו פנייה · ${repliedCount} ענו, ${awaitingThem} טרם · תזכורות אוטומטיות`
          : `כל ${live} הספקים ענו · השיחות נענות אוטומטית`
        : `${live} שיחות פתוחות, ${repliedCount} ענו`;
    } else if (approved > 0) {
      activity = "ready_to_send";
      nextAction = `${approved} ספקים מאושרים, ממתינים שתשלח`;
    } else if (sent.length === 0 && project.sourceRfqFile) {
      activity = "ready_to_send";
      nextAction = "אין עדיין ספקים מאושרים";
    } else if (sent.length === 0) {
      activity = "draft";
      nextAction = "צריך להעלות RFQ";
    } else {
      activity = "stopped";
      nextAction = "אין שיחה חיה ואין למי לשלוח";
    }

    out.set(project.id, {
      id: project.id,
      autonomous: project.autonomyTier >= 3,
      activity,
      liveThreads: live,
      openQuestions: questions,
      waitingToSend: approved,
      lastActivity: lastActivity ?? null,
      nextAction,
    });
  }

  return out;
}
