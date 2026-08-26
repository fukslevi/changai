/**
 * Thirty cold emails a day, taken from the front of the queue.
 *
 * The unit is the daily email count, not the project. A project is where the
 * addresses come from, and if it only has nineteen, its nineteen go out and the
 * remaining eleven come from the next project in line. What must hold is the
 * number leaving the mailbox: not more, and - just as much the point - not less.
 *
 * This replaces a rule that paced by project instead: one project sending at a
 * time, the slot changing hands once a day. That guaranteed the ceiling and
 * quietly gave up the floor. A project with nineteen suppliers spent the whole
 * day sending nineteen, and the eleven emails the day could have carried simply
 * never went - which over a week is a project's worth of outreach lost to a
 * rule meant to protect the mailbox.
 *
 * The queue drains oldest first, so the shape is still roughly one project a
 * day. That is a consequence of the ordering rather than a constraint, which is
 * the right way round: nothing has to be true about projects for the mailbox to
 * be safe, only about the count.
 *
 * Replies are outside all of it. They never queue and never count. Answering
 * someone who wrote to you first builds the mailbox's standing rather than
 * spending it, and a supplier waiting on an answer should not wait because a
 * different product is having its turn.
 */
import { and, asc, eq, gte, isNull, sql } from "drizzle-orm";
import { db, messages, projects, settings } from "../db";
import { campaignStatus } from "./batch";

export interface SlotState {
  /** The project currently at the front of the queue, if any. */
  holderId: string | null;
  holderName: string | null;
  /** Projects with suppliers still to write to, in the order they will send. */
  queue: { id: string; name: string; position: number; pending: number }[];
  /** Cold emails sent today, across every project. */
  sentToday: number;
  /** What is left of today's allowance. */
  remainingToday: number;
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
 * second copy of the truth and the first thing to drift.
 *
 * What counts is mail to somebody who has never written to us. First contact
 * obviously. Chases too - a factory that received an enquiry and ignored it is
 * being written to a second time unasked, which is the pattern the allowance
 * exists to meter.
 *
 * Replies and price asks do not. Both go to a supplier who already wrote back,
 * on a thread they are reading, and a warm thread is not what puts a mailbox at
 * risk - a factory that answered us and is asked for its number is the safest
 * mail in the system after a direct reply. Making them compete with first
 * contact for the same thirty would have meant a day of chasing prices was a
 * day of finding nobody new, which is a trade the allowance was never meant to
 * force.
 */
export async function coldSentToday(projectId?: string): Promise<number> {
  const rows = await db
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.direction, "outbound"),
        gte(messages.receivedAt, startOfToday()),
        projectId ? eq(messages.projectId, projectId) : sql`true`,
        sql`${messages.outboundKind} is distinct from 'reply'`,
        sql`${messages.outboundKind} is distinct from 'price_ask'`,
      ),
    );

  return rows.length;
}

/** What is left of today's allowance, across every project. */
export async function remainingToday(): Promise<number> {
  return Math.max(0, (await maxColdPerDay()) - (await coldSentToday()));
}

/**
 * Projects with suppliers still to write to, oldest first.
 *
 * Oldest first is what makes the day drain one project at a time without
 * anything having to enforce it: the front project takes what it needs, and
 * only what is left over reaches the next one.
 */
async function queue(): Promise<{ id: string; name: string; pending: number }[]> {
  const live = await db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(and(isNull(projects.pausedAt), isNull(projects.archivedAt)))
    .orderBy(asc(projects.createdAt));

  const out: { id: string; name: string; pending: number }[] = [];
  for (const project of live) {
    const status = await campaignStatus(project.id);
    if (status.pending.length > 0) {
      out.push({ id: project.id, name: project.name, pending: status.pending.length });
    }
  }
  return out;
}

export async function slotState(): Promise<SlotState> {
  const [waiting, cap, sentToday] = await Promise.all([
    queue(),
    maxColdPerDay(),
    coldSentToday(),
  ]);

  const remaining = Math.max(0, cap - sentToday);
  const front = waiting[0] ?? null;

  let summaryHe: string;
  if (waiting.length === 0) {
    summaryHe = `אין ספקים שממתינים לפנייה · ${sentToday}/${cap} מיילים היום`;
  } else if (remaining === 0) {
    summaryHe = `מכסת היום מוצתה (${sentToday}/${cap}) · ${waiting.length} פרויקטים ממשיכים מחר`;
  } else {
    const totalPending = waiting.reduce((sum, p) => sum + p.pending, 0);
    summaryHe =
      `${sentToday}/${cap} מיילים היום · עוד ${remaining} ייצאו מ-${front!.name}` +
      (waiting.length > 1 ? ` ואחריו ${waiting.length - 1} פרויקטים (${totalPending} ספקים בסך הכל)` : "");
  }

  return {
    holderId: front?.id ?? null,
    holderName: front?.name ?? null,
    queue: waiting.map((p, i) => ({ ...p, position: i + 1 })),
    sentToday,
    remainingToday: remaining,
    maxPerDay: cap,
    summaryHe,
  };
}

/**
 * When this project's cold outreach next moves.
 *
 * Today if the allowance still has room and nothing older is ahead of it;
 * tomorrow otherwise. There is no longer a multi-day queue position to compute,
 * because a project no longer occupies a whole day - it occupies as much of the
 * day's thirty as it has suppliers for.
 */
export async function turnStartsAt(projectId: string, now = new Date()): Promise<Date | null> {
  const decision = await mayStartOutreach(projectId);
  if (decision.may) return now;

  /*
   * Only the daily cap has a knowable date. Waiting behind an older project
   * could mean an hour or a week, depending on how fast its list drains - and
   * "tomorrow" next to "will continue when their list runs out" is the page
   * asserting something it cannot know. The reason carries it instead.
   */
  if (decision.reason !== "daily cap") return null;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
}

export type SlotDecision =
  | { may: true; remaining: number }
  | { may: false; reasonHe: string; reason: string };

/**
 * May this project send cold email right now, and how many.
 *
 * Three questions, in order: is the project running, is there anything left of
 * today's thirty, and is anything older still working through its list. The
 * answer is a number rather than a yes, because the interesting case is a
 * project that may send four more rather than none.
 */
export async function mayStartOutreach(projectId: string): Promise<SlotDecision> {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) return { may: false, reason: "no project", reasonHe: "הפרויקט לא נמצא" };

  if (project.pausedAt || project.archivedAt) {
    return { may: false, reason: "off", reasonHe: "הפרויקט כבוי" };
  }

  const cap = await maxColdPerDay();
  const sent = await coldSentToday();
  const remaining = cap - sent;

  if (remaining <= 0) {
    return {
      may: false,
      reason: "daily cap",
      reasonHe: `מכסת היום מוצתה (${sent}/${cap}) · ממשיך מחר`,
    };
  }

  const waiting = await queue();
  const mine = waiting.find((p) => p.id === projectId);
  if (!mine) {
    return { may: false, reason: "nothing to send", reasonHe: "אין ספקים שממתינים לפנייה" };
  }

  /*
   * Anything older with suppliers still to write to goes first.
   *
   * Not a reservation - the older project takes only what it needs, and the
   * moment its list runs out the rest of the day's allowance is available here.
   * That is what "if it does not have thirty, start the next one" means in
   * practice: the handover happens when the list empties, not when the day does.
   */
  const front = waiting[0]!;
  if (front.id !== projectId) {
    return {
      may: false,
      reason: "older project first",
      reasonHe: `${front.name} לפניו בתור (${front.pending} ספקים) · ימשיך כשהרשימה שלו תיגמר`,
    };
  }

  return { may: true, remaining };
}

/** Recorded for the history, not consulted for permission any more. */
export async function claimSlot(projectId: string): Promise<void> {
  await db
    .update(projects)
    .set({ outreachStartedAt: new Date() })
    .where(and(eq(projects.id, projectId), isNull(projects.outreachStartedAt)));
}

/** Stamped when a project has written to everyone approved. */
export async function releaseSlot(projectId: string): Promise<void> {
  await db
    .update(projects)
    .set({ outreachCompletedAt: new Date() })
    .where(and(eq(projects.id, projectId), isNull(projects.outreachCompletedAt)));
}
