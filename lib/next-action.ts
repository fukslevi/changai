/**
 * When the system will next do something, and what.
 *
 * "Last reply 7 hours ago" is alarming and, here, entirely normal: replies wait
 * for Chinese business hours, so between six in the evening and nine the next
 * morning their time, nothing goes out and nothing is wrong. A system that only
 * shows when it last acted leaves the operator to work out for themselves
 * whether silence means waiting or broken - and those look identical.
 *
 * Three clocks decide the answer, and they are genuinely different:
 *
 *   The cycle    - every two hours, from GitHub. Nothing happens between runs.
 *   Their day    - replies land near the top of a supplier's inbox during their
 *                  working hours, which is worth a few hours' wait.
 *   The slot     - one project sends cold mail per day, so a queued project's
 *                  answer is a date rather than a time.
 *
 * Everything here is derived. A stored "next run" would be wrong the first time
 * a cycle was late, which is most of them.
 */
import { and, eq, isNull } from "drizzle-orm";
import { db, messages, projects } from "./db";
import { withinSupplierHours } from "./inbox/autopilot";
import { campaignStatus } from "./outreach/batch";
import { mayStartOutreach, turnStartsAt } from "./outreach/slot";
import { silentThreads } from "./inbox/followup";

export interface NextAction {
  kind: "reply" | "outreach" | "chase" | "idle";
  /** What will happen, in Hebrew. */
  labelHe: string;
  count: number;
  /** When, as far as we can tell. Null when there is nothing to wait for. */
  at: Date | null;
  /** Why not sooner. Null when the answer is simply "next cycle". */
  whyHe: string | null;
}

/**
 * The next scheduled cycle.
 *
 * GitHub's cron is "every two hours", and GitHub is habitually late - the runs
 * this week landed between :20 and :30 past. Reporting the scheduled minute as
 * if it were a promise would make the system look broken twice a day, so the
 * caller is told this is approximate.
 */
export function nextCycleAt(now = new Date()): Date {
  const next = new Date(now);
  next.setUTCMinutes(0, 0, 0);
  next.setUTCHours(next.getUTCHours() + 1);
  // Runs on even hours UTC.
  if (next.getUTCHours() % 2 !== 0) next.setUTCHours(next.getUTCHours() + 1);
  return next;
}

/**
 * The next moment a reply may go out.
 *
 * Walks forward an hour at a time rather than doing the calendar arithmetic:
 * the window has a weekend rule and a timezone offset, and stepping the same
 * predicate the sender uses cannot disagree with it. A week of hours is 168
 * cheap iterations.
 */
export function nextSupplierWindow(now = new Date()): Date | null {
  if (withinSupplierHours(now)) return now;

  const cursor = new Date(now);
  cursor.setUTCMinutes(0, 0, 0);

  for (let i = 0; i < 24 * 8; i++) {
    cursor.setUTCHours(cursor.getUTCHours() + 1);
    if (withinSupplierHours(cursor)) return new Date(cursor);
  }
  return null;
}

/** Midnight, when the outreach slot frees up for a new project. */
export function nextDayStart(now = new Date()): Date {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return next;
}

/** Hebrew counts one thing differently from many. "1 ספקים" reads as a bug. */
function suppliers(n: number): string {
  return n === 1 ? "ספק אחד" : `${n} ספקים`;
}

/** The later of two moments - a reply needs both a cycle and an open window. */
function later(a: Date, b: Date): Date {
  return a.getTime() > b.getTime() ? a : b;
}

/**
 * What is queued for one project, and when each part of it moves.
 *
 * Ordered by when it happens, so the first line is the answer to "what is it
 * doing right now".
 */
export async function nextActionsFor(
  projectId: string,
  now = new Date(),
): Promise<NextAction[]> {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) return [];

  if (project.archivedAt) {
    return [{ kind: "idle", labelHe: "בארכיון - שום דבר לא מתוזמן", count: 0, at: null, whyHe: null }];
  }
  if (project.pausedAt) {
    return [{ kind: "idle", labelHe: "כבוי - שום דבר לא מתוזמן", count: 0, at: null, whyHe: null }];
  }

  const cycle = nextCycleAt(now);
  const actions: NextAction[] = [];

  // Replies: supplier messages nobody has handled.
  const unanswered = await db
    .select({ supplierId: messages.supplierId })
    .from(messages)
    .where(
      and(
        eq(messages.projectId, projectId),
        eq(messages.direction, "inbound"),
        isNull(messages.handledAt),
      ),
    );

  const awaiting = new Set(unanswered.map((m) => m.supplierId)).size;
  if (awaiting > 0) {
    const window = nextSupplierWindow(now);
    const open = withinSupplierHours(now);
    actions.push({
      kind: "reply",
      labelHe: `מענה ל${awaiting === 1 ? "" : "-"}${suppliers(awaiting)}`,
      count: awaiting,
      at: window ? later(cycle, window) : null,
      whyHe: open ? null : "תשובות יוצאות בשעות העבודה בסין, 9:00-18:00 בימים א'-ה'",
    });
  }

  // Cold outreach: approved suppliers not yet written to.
  const campaign = await campaignStatus(projectId);
  if (campaign.pending.length > 0) {
    const slot = await mayStartOutreach(projectId);
    /*
     * The queue owns this date. Working it out here as "tomorrow" was wrong for
     * anyone past the front of the line - second in the queue is the day after
     * tomorrow, not tonight at midnight - and it disagreed with the two other
     * places on the page that were also answering it.
     */
    const turn = await turnStartsAt(projectId, now);
    actions.push({
      kind: "outreach",
      labelHe: `פנייה ראשונה ל${campaign.pending.length === 1 ? "" : "-"}${suppliers(campaign.pending.length)}`,
      count: campaign.pending.length,
      at: slot.may ? cycle : turn,
      whyHe: slot.may ? null : slot.reasonHe,
    });
  }

  // Chases: threads gone quiet long enough.
  const due = (await silentThreads(projectId)).filter((t) => t.due);
  if (due.length > 0) {
    const window = nextSupplierWindow(now);
    actions.push({
      kind: "chase",
      labelHe: `תזכורת ל${due.length === 1 ? "" : "-"}${suppliers(due.length)} ששותקים`,
      count: due.length,
      at: window ? later(cycle, window) : null,
      whyHe: withinSupplierHours(now)
        ? null
        : "תזכורות יוצאות בשעות העבודה בסין, 9:00-18:00 בימים א'-ה'",
    });
  }

  if (actions.length === 0) {
    const waiting = (await silentThreads(projectId)).filter((t) => !t.due && !t.exhausted);
    if (waiting.length > 0) {
      const soonest = Math.min(...waiting.map((t) => t.dueInDays));
      actions.push({
        kind: "idle",
        labelHe: `ממתין לתשובות מ${waiting.length === 1 ? "" : "-"}${suppliers(waiting.length)}`,
        count: waiting.length,
        at: null,
        whyHe:
          soonest > 0
            ? `התזכורת הבאה בעוד ${soonest} ימים אם לא יענו`
            : "התזכורת הבאה במחזור הקרוב",
      });
    } else {
      actions.push({
        kind: "idle",
        labelHe: "אין משימה מתוזמנת",
        count: 0,
        at: null,
        whyHe: "התיבה נסרקת בכל מחזור; ברגע שספק יענה, התשובה תיכנס לתור",
      });
    }
  }

  return actions.sort((a, b) => (a.at?.getTime() ?? Infinity) - (b.at?.getTime() ?? Infinity));
}
