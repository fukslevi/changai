/**
 * One project sends cold email at a time, and the slot changes hands once a day.
 *
 * Both halves are load-bearing, and each alone has a hole:
 *
 *   One at a time, alone - a project that finishes by ten in the morning hands
 *   over to another that sends thirty more the same afternoon. Sixty in a day.
 *
 *   One a day, alone - a project takes several cycles to work through its
 *   shortlist, so Monday's project is still sending when Tuesday's starts, and
 *   Wednesday has three of them going at once.
 *
 * Together they mean at most one project's worth of cold mail in any day, which
 * is what "one project a day" was meant to promise. The daily cap on how much
 * the holder may send is the third piece: without a number, "a project's worth"
 * is however many suppliers that project happened to find.
 *
 * Replies are not affected by any of this and never queue. Answering someone
 * who wrote to you first is the safest mail there is - it is what builds the
 * mailbox's standing rather than spending it - and a supplier waiting on an
 * answer should not wait because a different product is having its turn.
 */
import { and, asc, eq, gte, isNotNull, isNull, sql } from "drizzle-orm";
import { db, messages, projects, settings } from "../db";

export interface SlotState {
  /** The project currently allowed to send cold email, if any. */
  holderId: string | null;
  holderName: string | null;
  /** Projects waiting, in the order they will be granted it. */
  queue: { id: string; name: string; position: number }[];
  /** True when the slot changed hands today and cannot change again. */
  grantedToday: boolean;
  /** Cold emails the holder has already sent today. */
  sentToday: number;
  maxPerDay: number;
  /** Hebrew, for the page. */
  summaryHe: string;
}

function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export async function maxColdPerDay(): Promise<number> {
  const [row] = await db.select().from(settings).where(eq(settings.id, "default"));
  return row?.maxColdPerDay ?? 30;
}

/**
 * Cold mail sent today, across everything.
 *
 * Counted from the messages rather than from a counter, because a counter is a
 * second copy of the truth and the first thing to drift. First contact and
 * chases both count - a chase is unsolicited mail to somebody who did not
 * answer, which is the same thing the pacing exists to control.
 */
export async function coldSentToday(projectId?: string): Promise<number> {
  const since = startOfToday();

  const rows = await db
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.direction, "outbound"),
        gte(messages.receivedAt, since),
        projectId ? eq(messages.projectId, projectId) : sql`true`,
        // Replies are the one kind that never counts.
        sql`${messages.outboundKind} is distinct from 'reply'`,
      ),
    );

  return rows.length;
}

/** Projects that still want the slot, oldest first. */
async function waiting() {
  return db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(
      and(
        isNull(projects.pausedAt),
        isNull(projects.archivedAt),
        isNull(projects.outreachStartedAt),
      ),
    )
    .orderBy(asc(projects.createdAt));
}

/** Who holds the slot: started sending, has not finished. */
async function holder() {
  const [row] = await db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(
      and(
        isNull(projects.pausedAt),
        isNull(projects.archivedAt),
        isNotNull(projects.outreachStartedAt),
        isNull(projects.outreachCompletedAt),
      ),
    )
    .orderBy(asc(projects.outreachStartedAt))
    .limit(1);

  return row ?? null;
}

/**
 * Whether today's turn is already spent.
 *
 * The first version of this asked only whether a grant had been issued today,
 * and the test caught it immediately: a project granted the slot yesterday that
 * sends this morning and finishes at noon has issued no grant today, so the
 * next project was cleared to send another thirty this afternoon. Sixty in a
 * day, from a rule whose entire purpose was thirty.
 *
 * What matters is not when the slot was handed over but whether cold mail has
 * gone out today. That is measured from the messages, which is the thing the
 * limit is actually about. The grant check stays as well, for the case where a
 * project has taken the slot but not yet sent its first email - otherwise two
 * projects could both claim it in the same cycle.
 */
async function dayAlreadyUsed(): Promise<boolean> {
  const granted = await db
    .select({ startedAt: projects.outreachStartedAt })
    .from(projects)
    .where(
      and(isNotNull(projects.outreachStartedAt), gte(projects.outreachStartedAt, startOfToday())),
    );

  if (granted.length > 0) return true;

  return (await coldSentToday()) > 0;
}

export async function slotState(): Promise<SlotState> {
  const [current, queued, granted, cap] = await Promise.all([
    holder(),
    waiting(),
    dayAlreadyUsed(),
    maxColdPerDay(),
  ]);

  const sentToday = current ? await coldSentToday(current.id) : await coldSentToday();

  const queue = queued.map((p, i) => ({ id: p.id, name: p.name, position: i + 1 }));

  let summaryHe: string;
  if (current) {
    summaryHe =
      sentToday >= cap
        ? `${current.name} שולח · הגיע למכסת היום (${sentToday}/${cap}). ממשיך מחר`
        : `${current.name} שולח · ${sentToday}/${cap} היום`;
  } else if (queue.length === 0) {
    summaryHe = "אין פרויקט בשליחה. כל מה שפעיל כבר פנה לספקים שלו";
  } else if (granted) {
    summaryHe = `${queue.length} ממתינים · כבר יצאו פניות היום, הבא מתחיל מחר`;
  } else {
    const next = queue[0]!;
    summaryHe =
      queue.length === 1
        ? `${next.name} יתחיל לשלוח במחזור הקרוב`
        : `${next.name} יתחיל לשלוח במחזור הקרוב · ${queue.length - 1} אחריו`;
  }

  return {
    holderId: current?.id ?? null,
    holderName: current?.name ?? null,
    queue,
    grantedToday: granted,
    sentToday,
    maxPerDay: cap,
    summaryHe,
  };
}

export type SlotDecision =
  | { may: true; remaining: number }
  | { may: false; reasonHe: string; reason: string };

/**
 * May this project send cold email right now, and how much.
 *
 * Called before every campaign run. The answer is deliberately a number rather
 * than a yes, because the interesting case is the holder who has some of its
 * daily allowance left rather than none.
 */
export async function mayStartOutreach(projectId: string): Promise<SlotDecision> {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) return { may: false, reason: "no project", reasonHe: "הפרויקט לא נמצא" };

  if (project.pausedAt || project.archivedAt) {
    return { may: false, reason: "off", reasonHe: "הפרויקט כבוי" };
  }

  const cap = await maxColdPerDay();

  // Already holds it: send whatever is left of today's allowance.
  if (project.outreachStartedAt && !project.outreachCompletedAt) {
    const sent = await coldSentToday(projectId);
    const remaining = cap - sent;
    return remaining > 0
      ? { may: true, remaining }
      : {
          may: false,
          reason: "daily cap",
          reasonHe: `הגיע למכסת היום (${sent}/${cap}). ממשיך מחר`,
        };
  }

  // Finished already - it answers replies, it does not send cold mail.
  if (project.outreachCompletedAt) {
    return { may: false, reason: "finished", reasonHe: "כל הספקים כבר קיבלו פנייה" };
  }

  // Wants the slot. Is anybody holding it?
  const current = await holder();
  if (current) {
    return {
      may: false,
      reason: "slot taken",
      reasonHe: `${current.name} באמצע שליחה. הפרויקט הזה מחכה לתורו`,
    };
  }

  if (await dayAlreadyUsed()) {
    return {
      may: false,
      reason: "day already used",
      reasonHe: "כבר יצאו פניות היום מפרויקט אחר. הפרויקט הזה מתחיל מחר",
    };
  }

  // Only the front of the queue may take it.
  const queue = await waiting();
  if (queue[0] && queue[0].id !== projectId) {
    return {
      may: false,
      reason: "not first in queue",
      reasonHe: `${queue[0].name} לפניו בתור`,
    };
  }

  return { may: true, remaining: cap };
}

/** Take the slot. Called once, when the first cold email of a project goes out. */
export async function claimSlot(projectId: string): Promise<void> {
  await db
    .update(projects)
    .set({ outreachStartedAt: new Date() })
    .where(and(eq(projects.id, projectId), isNull(projects.outreachStartedAt)));
}

/**
 * Give the slot up, once everyone approved has been written to.
 *
 * The next project still waits for tomorrow - `grantedToday` sees the stamp
 * this project left behind. That is the point rather than a side effect: a
 * campaign that finishes at ten in the morning must not let a second one start
 * the same day.
 */
export async function releaseSlot(projectId: string): Promise<void> {
  await db
    .update(projects)
    .set({ outreachCompletedAt: new Date() })
    .where(
      and(
        eq(projects.id, projectId),
        isNotNull(projects.outreachStartedAt),
        isNull(projects.outreachCompletedAt),
      ),
    );
}
