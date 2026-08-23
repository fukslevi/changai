/**
 * Chase the silence.
 *
 * A supplier who never answers is the most common outcome of any outreach
 * round, and until now nothing happened to them at all - the thread simply sat
 * there looking identical to one that was still being worked. Two thirds of
 * this project's suppliers are in exactly that state.
 *
 * Two chases, then the thread closes. Not because a third would be rude, but
 * because a list that never closes anything stops telling you how many live
 * conversations you actually have, which is the number the whole round is for.
 */
import { and, asc, eq, isNotNull } from "drizzle-orm";
import { db, messages, outreach, projects, supplierLeads, suppliers } from "../db";
import { sendReply } from "./reply";

/** Days of silence before the first chase, and again before the second. */
const FIRST_CHASE_DAYS = 4;
const SECOND_CHASE_DAYS = 7;
const MAX_CHASES = 2;

export interface SilentThread {
  supplierId: string;
  company: string;
  daysSilent: number;
  chasesSent: number;
  /** Whether they have ever written back at all. */
  everReplied: boolean;
  due: boolean;
  /** Set when the thread has run out of chases. */
  exhausted: boolean;
}

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}

/**
 * A first chase written from the RFQ, and a second that offers the way out.
 *
 * The closing line matters more than it looks: a factory that cannot make the
 * product has no reason to reply at all, so most of the silence is not rudeness
 * but absence of an easy exit. Giving them one converts silence into a "no",
 * which is a usable answer.
 */
function chaseBody(productName: string, attempt: number, everReplied: boolean): string {
  if (attempt === 1) {
    return everReplied
      ? `Following up on my last message about the ${productName}.

Could you let me know where the quotation stands? If anything in the specification is unclear, tell me which point and I will clarify it.`
      : `I wrote last week about the ${productName} and have not heard back.

If this is something you manufacture, I would still like your quotation - the specification and quantities are in the attachment of my first email.

If it is not a product you make, just reply and say so and I will not chase again.`;
  }

  return `Last note from me on the ${productName}.

If you would like to quote, reply any time and I will pick it up. If not, no reply is needed - I will assume it is not a fit and close it off.

Thanks for your time either way.`;
}

/** Threads where we spoke last and nothing came back. */
export async function silentThreads(projectId: string): Promise<SilentThread[]> {
  const rows = await db
    .select({
      supplierId: messages.supplierId,
      company: suppliers.companyName,
      direction: messages.direction,
      subject: messages.subject,
      receivedAt: messages.receivedAt,
    })
    .from(messages)
    .leftJoin(suppliers, eq(messages.supplierId, suppliers.id))
    .where(eq(messages.projectId, projectId))
    .orderBy(asc(messages.receivedAt));

  const bySupplier = new Map<
    string,
    { company: string; last: Date; lastDir: string; chases: number; inbound: number }
  >();

  for (const row of rows) {
    if (!row.supplierId) continue;
    const entry = bySupplier.get(row.supplierId) ?? {
      company: row.company ?? "ספק",
      last: row.receivedAt,
      lastDir: row.direction,
      chases: 0,
      inbound: 0,
    };

    if (row.direction === "inbound") entry.inbound++;
    // A chase is an outbound message we sent with nothing from them in between;
    // marking them at send time is simpler than inferring it later.
    if (row.direction === "outbound" && (row.subject ?? "").startsWith("Chase:")) entry.chases++;

    if (row.receivedAt >= entry.last) {
      entry.last = row.receivedAt;
      entry.lastDir = row.direction;
    }
    entry.company = row.company ?? entry.company;
    bySupplier.set(row.supplierId, entry);
  }

  const now = new Date();
  const out: SilentThread[] = [];

  for (const [supplierId, entry] of bySupplier) {
    if (entry.lastDir !== "outbound") continue; // the ball is with us, not them

    const daysSilent = daysBetween(entry.last, now);
    const threshold = entry.chases === 0 ? FIRST_CHASE_DAYS : SECOND_CHASE_DAYS;

    out.push({
      supplierId,
      company: entry.company,
      daysSilent,
      chasesSent: entry.chases,
      everReplied: entry.inbound > 0,
      due: entry.chases < MAX_CHASES && daysSilent >= threshold,
      exhausted: entry.chases >= MAX_CHASES,
    });
  }

  return out.sort((a, b) => b.daysSilent - a.daysSilent);
}

export interface FollowUpResult {
  chased: { company: string; attempt: number }[];
  closed: { company: string }[];
  waiting: { company: string; daysSilent: number; dueInDays: number }[];
}

/**
 * Send whatever chases are due, and close the threads that have had their two.
 *
 * Closing marks the outreach row, not the supplier - the company stays in the
 * permanent database and may well answer on the next product.
 */
export async function runFollowUps(
  projectId: string,
  options: { send?: boolean } = {},
): Promise<FollowUpResult> {
  const send = options.send ?? true;
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) throw new Error("Project not found");

  const takenOver = new Set(
    (
      await db
        .select({ supplierId: supplierLeads.supplierId })
        .from(supplierLeads)
        .where(
          and(eq(supplierLeads.projectId, projectId), isNotNull(supplierLeads.takenOverAt)),
        )
    ).map((r) => r.supplierId),
  );

  // A thread the operator took over does not get chased either.
  const threads = (await silentThreads(projectId)).filter(
    (t) => !takenOver.has(t.supplierId),
  );
  const result: FollowUpResult = { chased: [], closed: [], waiting: [] };

  for (const thread of threads) {
    if (thread.exhausted) {
      if (send) {
        await db
          .update(outreach)
          .set({ status: "failed", error: "no reply after two follow-ups" })
          .where(
            and(
              eq(outreach.projectId, projectId),
              eq(outreach.supplierId, thread.supplierId),
              eq(outreach.status, "sent"),
            ),
          );
      }
      result.closed.push({ company: thread.company });
      continue;
    }

    if (!thread.due) {
      const threshold = thread.chasesSent === 0 ? FIRST_CHASE_DAYS : SECOND_CHASE_DAYS;
      result.waiting.push({
        company: thread.company,
        daysSilent: thread.daysSilent,
        dueInDays: threshold - thread.daysSilent,
      });
      continue;
    }

    const attempt = thread.chasesSent + 1;
    if (send) {
      await sendReply(
        projectId,
        thread.supplierId,
        chaseBody(project.name, attempt, thread.everReplied),
        { subjectPrefix: "Chase:" },
      );
    }
    result.chased.push({ company: thread.company, attempt });
  }

  return result;
}
