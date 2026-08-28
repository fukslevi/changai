/**
 * Whether the Anthropic API still has credit, and saying so where it is seen.
 *
 * Every judgement this system makes is a model call - reading a supplier's
 * reply, scoring a lead, parsing an RFQ, drafting an answer. An empty balance
 * stops all of it while leaving the app looking perfectly healthy: the pages
 * load, the numbers render, and mail even keeps going out, because sending is
 * the one step that needs no model at all.
 *
 * That is exactly how it went unnoticed on 28.08. The balance emptied, the
 * cycle kept returning 200, and the only evidence was a stringified API error
 * buried in a cron summary. The page said "last cycle 04:30", which reads as a
 * schedule running late rather than an agent that had stopped thinking.
 *
 * So the status is recorded from two directions:
 *
 *   - Opportunistically, from real failures. If a live call comes back with an
 *     empty-balance error, that is not a suspicion, it is the answer, and it
 *     costs nothing to record.
 *   - On a schedule, with a deliberate probe. A failure is self-reporting;
 *     recovery is not. Without a probe the banner would stay red until the next
 *     thing happened to fail - which is never, because nothing is running.
 */
import { eq } from "drizzle-orm";
import Anthropic from "@anthropic-ai/sdk";
import { db, settings } from "../db";

const SINGLETON_ID = "default";

/** How stale a passing check may be before it is worth spending a probe. */
export const PROBE_EVERY_MS = 24 * 60 * 60 * 1000;

/**
 * The API says this in prose rather than in a code, so prose is what we match.
 * Kept deliberately loose - it has to survive rewording - and only ever used to
 * classify an error that already happened, never to decide whether to call.
 */
const EMPTY_BALANCE = /credit balance is too low|insufficient credit|billing/i;

export function isCreditError(error: unknown): boolean {
  const text =
    error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return EMPTY_BALANCE.test(text);
}

export interface CreditStatus {
  /** null = never checked. Not the same as "no credit", and shown differently. */
  ok: boolean | null;
  checkedAt: Date | null;
  message: string | null;
  /** True when a passing check is older than the probe interval. */
  stale: boolean;
}

export async function creditStatus(): Promise<CreditStatus> {
  const [row] = await db.select().from(settings).where(eq(settings.id, SINGLETON_ID));
  const checkedAt = row?.creditCheckedAt ?? null;
  return {
    ok: row?.creditOk ?? null,
    checkedAt,
    message: row?.creditMessage ?? null,
    stale: checkedAt === null || Date.now() - checkedAt.getTime() > PROBE_EVERY_MS,
  };
}

async function write(ok: boolean, message: string | null): Promise<void> {
  const now = new Date();
  await db
    .insert(settings)
    .values({ id: SINGLETON_ID, creditOk: ok, creditCheckedAt: now, creditMessage: message })
    .onConflictDoUpdate({
      target: settings.id,
      set: { creditOk: ok, creditCheckedAt: now, creditMessage: message },
    });
}

/**
 * Record a real failure. Safe to call from anywhere that has caught an error:
 * anything that is not an empty-balance error is ignored, so callers do not
 * have to classify it themselves.
 */
export async function noteApiError(error: unknown): Promise<boolean> {
  if (!isCreditError(error)) return false;
  const text = error instanceof Error ? error.message : String(error);
  await write(false, text.slice(0, 500));
  return true;
}

/**
 * Ask the API directly.
 *
 * One token, from the model the system actually depends on. Probing a cheaper
 * model would answer a different question than the one being asked: the point
 * is not whether the API responds, it is whether the work can run, and a green
 * light earned by a model nothing uses is worse than no light at all. At
 * max_tokens 1 the cost is a rounding error either way.
 *
 * It runs at most once a day while the balance is healthy, and at every
 * opportunity while it is not, because what is being waited for then is
 * recovery.
 */
export async function probeCredit(options: { force?: boolean } = {}): Promise<CreditStatus> {
  const before = await creditStatus();
  const due = options.force || before.ok !== true || before.stale;
  if (!due) return before;

  try {
    await new Anthropic().messages.create({
      model: "claude-opus-5",
      max_tokens: 1,
      messages: [{ role: "user", content: "ok" }],
    });
    await write(true, null);
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (isCreditError(error)) {
      await write(false, text.slice(0, 500));
    } else {
      /*
       * A network blip or a rate limit is not an empty balance, and recording
       * it as one would raise a false alarm that costs a person real time. The
       * previous verdict stands and the probe is retried next cycle.
       */
      return before;
    }
  }

  return creditStatus();
}

/** Marks that the alert went out, so the next one is a day away rather than an hour. */
export async function markCreditAlerted(): Promise<void> {
  await db
    .insert(settings)
    .values({ id: SINGLETON_ID, creditAlertedAt: new Date() })
    .onConflictDoUpdate({ target: settings.id, set: { creditAlertedAt: new Date() } });
}

export async function creditAlertedAt(): Promise<Date | null> {
  const [row] = await db.select().from(settings).where(eq(settings.id, SINGLETON_ID));
  return row?.creditAlertedAt ?? null;
}
