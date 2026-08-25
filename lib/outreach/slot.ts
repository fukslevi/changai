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
import { db, messages, projects, settings, supplierLeads } from "../db";
import { AUTO_APPROVE_SCORE, MAX_DISCOVERY_RUNS, TARGET_LEADS } from "../discovery/run";

/**
 * How long a project may hold up the queue while it is still searching.
 *
 * Some products have twelve manufacturers in the world and will never reach
 * thirty. Waiting forever for a number that is not out there would let one
 * narrow product block every other project indefinitely.
 */
const MAX_DAYS_SEARCHING = 3;

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

/**
 * The day this project's cold outreach actually begins.
 *
 * Position in the queue is a number of days, not a place in a list: the slot
 * changes hands once a day, so second in line means the day after tomorrow.
 * Three separate parts of the page were each answering this for themselves and
 * giving three different answers on the same row - "starts tomorrow", "in about
 * 4 hours", and "in the coming cycles" - which is what a queue position looks
 * like when nothing owns the calculation.
 */
export async function turnStartsAt(projectId: string, now = new Date()): Promise<Date | null> {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project || project.pausedAt || project.archivedAt) return null;

  const decision = await mayStartOutreach(projectId);
  if (decision.may) return now;

  /*
   * A project still searching has no date, and saying otherwise is worse than
   * saying nothing: "first contact in 1 minute" next to "still searching" is
   * the page contradicting itself again, and the confident half is the wrong
   * half. The reason carries the information; the clock cannot.
   */
  if (decision.reason === "still searching") return null;

  // Out of allowance but still holding the slot: it resumes at midnight.
  if (project.outreachStartedAt && !project.outreachCompletedAt) {
    return startOfTomorrow(now, 1);
  }

  const queue = await waiting();
  const index = queue.findIndex((p) => p.id === projectId);
  if (index === -1) return null;

  const current = await holder();
  const used = await dayAlreadyUsed();

  /*
   * Everyone ahead takes a day, and the holder takes one more if it is still
   * sending. Days rather than hours: a project cannot start on the same day as
   * the one before it, however early that one finished.
   */
  const daysAhead = index + (current ? 1 : 0) + (used && !current ? 1 : 0);
  return startOfTomorrow(now, Math.max(daysAhead, used || current ? 1 : 0));
}

/** Midnight, `days` from now. Zero means today. */
function startOfTomorrow(now: Date, days: number): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
}

export interface Readiness {
  ready: boolean;
  usable: number;
  target: number;
  reasonHe: string;
}

/**
 * Has this project finished assembling its shortlist?
 *
 * The slot is one day per project, and a project that takes its day with
 * nineteen of thirty suppliers spends the day, sends nineteen, and then needs a
 * second day for the rest - pushing everything behind it back. Worse, the
 * queue looked like it was working: the page said "first contact to 16
 * suppliers" without ever mentioning that the search was still running.
 *
 * So the turn waits for the list. Bounded three ways, because some products
 * genuinely have twelve manufacturers: the target, the search angles running
 * out, or three days elapsed.
 */
export async function shortlistReady(projectId: string): Promise<Readiness> {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) {
    return { ready: false, usable: 0, target: TARGET_LEADS, reasonHe: "הפרויקט לא נמצא" };
  }

  const leads = await db
    .select({
      email: supplierLeads.email,
      status: supplierLeads.status,
      matchScore: supplierLeads.matchScore,
    })
    .from(supplierLeads)
    .where(eq(supplierLeads.projectId, projectId));

  const usable = leads.filter(
    (lead) =>
      (lead.email !== null || lead.status === "contacted") &&
      (lead.matchScore ?? 0) >= AUTO_APPROVE_SCORE &&
      lead.status !== "rejected",
  ).length;

  if (usable >= TARGET_LEADS) {
    return { ready: true, usable, target: TARGET_LEADS, reasonHe: "הרשימה מלאה" };
  }

  const roundsLeft = MAX_DISCOVERY_RUNS - (project.discoveryRuns ?? 0);
  if (roundsLeft <= 0) {
    return {
      ready: true,
      usable,
      target: TARGET_LEADS,
      reasonHe: `החיפוש מיצה את כל הזוויות ומצא ${usable}`,
    };
  }

  const daysSearching = Math.floor(
    (Date.now() - project.createdAt.getTime()) / 86_400_000,
  );
  if (daysSearching >= MAX_DAYS_SEARCHING) {
    return {
      ready: true,
      usable,
      target: TARGET_LEADS,
      reasonHe: `${daysSearching} ימים בחיפוש - יוצא לדרך עם ${usable}`,
    };
  }

  return {
    ready: false,
    usable,
    target: TARGET_LEADS,
    reasonHe: `עדיין מחפש - ${usable} מתוך ${TARGET_LEADS} ספקים ברי-פנייה, ${roundsLeft} זוויות חיפוש נותרו`,
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

  /*
   * A project still assembling its shortlist does not hold up the queue.
   *
   * It also does not take its day early. One slot per project per day only
   * means something if the project uses the day on a finished list - sending to
   * nineteen of thirty and coming back tomorrow for the rest costs two days and
   * pushes everything behind it back.
   */
  const readiness = await shortlistReady(projectId);
  if (!readiness.ready) {
    return { may: false, reason: "still searching", reasonHe: readiness.reasonHe };
  }

  const all = await waiting();
  const readiness_ = await Promise.all(all.map((p) => shortlistReady(p.id)));
  const queue = all.filter((_, i) => readiness_[i]!.ready);
  const place = queue.findIndex((p) => p.id === projectId);

  if (await dayAlreadyUsed()) {
    /*
     * "Tomorrow" is only true for whoever is at the front. Second in line is
     * the day after, and saying otherwise on every queued project is how the
     * page came to promise two of them the same day.
     */
    const days = place <= 0 ? 1 : place + 1;
    const whenHe =
      days === 1 ? "מתחיל מחר" : days === 2 ? "מתחיל מחרתיים" : `מתחיל בעוד ${days} ימים`;

    return {
      may: false,
      reason: "day already used",
      reasonHe:
        place <= 0
          ? `כבר יצאו פניות היום מפרויקט אחר. ${whenHe}`
          : `מקום ${place + 1} בתור · ${whenHe}`,
    };
  }

  // Only the front of the queue may take it.
  if (queue[0] && queue[0].id !== projectId) {
    return {
      may: false,
      reason: "not first in queue",
      reasonHe: `מקום ${place + 1} בתור · ${queue[0].name} לפניו`,
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
