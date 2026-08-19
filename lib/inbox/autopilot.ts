/**
 * Answer suppliers on their own, and stop when the answer is not ours to give.
 *
 * The rule is one sentence: if the documents already contain the answer, reply;
 * if they do not, park the question and wait. Inventing a specification in the
 * middle of a commercial negotiation is the one failure mode that cannot be
 * undone by a follow-up email - the supplier quotes against it, and the number
 * that comes back is a price for a product nobody agreed to build.
 *
 * A parked question is answered once and then belongs to the project. Suzhou
 * asked whether the basket is steel or aluminium; the other ten suppliers
 * either asked the same thing or, worse, assumed. One answer serves all of them.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, items, messages, openQuestions, projects, requirements, suppliers } from "../db";
import { checkDraft } from "../negotiate/guard";
import { loadMandate, mandateBrief, type Mandate } from "../negotiate/mandate";
import { attachmentContext } from "../quotes/context";
import { getSettings } from "../settings";
import { sendReply } from "./reply";

const ReplyPlan = z.object({
  /** True only when every open point can be answered from the material given. */
  answerable: z.boolean(),
  /**
   * Facts the supplier needs that nobody has decided. Empty when answerable.
   * Each one blocks the reply until a person answers it.
   */
  open_questions: z
    .array(
      z.object({
        /** As it will be put to the operator, in Hebrew. */
        question_he: z.string(),
        /** The same point in English, for the eventual reply to the supplier. */
        question_en: z.string(),
        /** Why the reply cannot go out without it. */
        why_he: z.string(),
        /**
         * "project" when the answer is a fact about the product and applies to
         * every supplier; "supplier" when it concerns only this conversation.
         */
        scope: z.enum(["project", "supplier"]),
      }),
    )
    .default([]),
  /** The reply body. Empty string when answerable is false. */
  draft: z.string(),
});

export type ReplyPlan = z.infer<typeof ReplyPlan>;

const SYSTEM = `You handle supplier correspondence for a company sourcing consumer products
from China. You are given the RFQ requirements, previously decided facts, and one
conversation.

Decide whether you can answer the supplier using ONLY the material provided.

ANSWERABLE
Set answerable true when every question they asked, and every point you need to
raise, is covered by the requirements or the decided facts. Then write the reply.

NEGOTIATING
If a negotiation mandate is supplied you may discuss price and terms inside it.
Open at the target price, move in small steps, and give a reason for every move -
volume, a longer lead time you can accept, a simpler carton. Never reveal the
ceiling and never mention a walk-away. If their price is already at or below the
ceiling, say the price works and move the conversation to the remaining terms
rather than pushing for more.

If no mandate is supplied, do not discuss price at all.

NOT ANSWERABLE
Set answerable false when the supplier needs a fact nobody has stated - a
material that the spec leaves open, a tolerance, a colour, a certification the
RFQ does not name. List each as an open question. Never guess, never offer a
range as though it were a decision, and never write "we will confirm" as a way
of moving past it. Leave draft empty.

Asking the supplier for something we want is not an open question - that is
ordinary chasing and you should just write it.

REPLY STYLE
- Address only what their message raised, plus the facts still missing from
  them. Never restate the whole specification - they already have the RFQ, and
  a wall of text buries the request that matters.
- Plain text. Short lines. No markdown.
- Short hyphen (-), never a long dash.
- Numbered list when asking for more than two things.
- Answer their questions first, then ask for what is missing.
- Never negotiate price. Never promise an order, a date or a sample.
- No signature - one is appended afterwards.`;

export interface ConversationContext {
  projectId: string;
  supplierId: string;
}

/** How many times we have written on this thread since the first outreach. */
async function roundsSoFar(projectId: string, supplierId: string): Promise<number> {
  const sent = await db
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.projectId, projectId),
        eq(messages.supplierId, supplierId),
        eq(messages.direction, "outbound"),
      ),
    );
  // The opening email is not a round of negotiation.
  return Math.max(0, sent.length - 1);
}

/** Facts a person has already decided for this project. */
async function decidedFacts(projectId: string): Promise<string[]> {
  const answered = await db
    .select()
    .from(openQuestions)
    .where(and(eq(openQuestions.projectId, projectId), eq(openQuestions.status, "answered")));

  return answered
    .filter((q) => q.answer)
    .map((q) => `${q.questionEn} -> ${q.answer as string}`);
}

export async function planReply(
  { projectId, supplierId }: ConversationContext,
  mandate?: Mandate,
): Promise<ReplyPlan> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set");

  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) throw new Error("Project not found");

  const [supplier] = await db.select().from(suppliers).where(eq(suppliers.id, supplierId));
  if (!supplier) throw new Error("Supplier not found");

  const [thread, projectRequirements, facts, projectItems] = await Promise.all([
    db
      .select()
      .from(messages)
      .where(and(eq(messages.projectId, projectId), eq(messages.supplierId, supplierId)))
      .orderBy(asc(messages.receivedAt)),
    db
      .select({ text: requirements.text })
      .from(requirements)
      .where(eq(requirements.projectId, projectId)),
    decidedFacts(projectId),
    db.select().from(items).where(eq(items.projectId, projectId)),
  ]);

  /*
   * The supplier is holding the RFQ deck, and the deck states target prices.
   * Without them here the model reasons only from the email body and can tell a
   * factory "we did not send a target price" - which contradicts the document
   * in their hand and makes us look like we are not reading our own paperwork.
   */
  const targets = projectItems
    .filter((i) => i.targetPrices.length > 0)
    .map(
      (i) =>
        `${i.name}: ` +
        i.targetPrices
          .map((t) => `${t.qty ?? "?"} pcs at $${t.unit_price ?? "?"}`)
          .join(", "),
    );

  const latest = [...thread].reverse().find((m) => m.direction === "inbound");

  /*
   * Read what they attached. Without this the planner sees "please check" and a
   * filename, decides it cannot judge a quotation it never opened, and hands
   * the thread to a person - which is the right call when you are blind, and
   * unnecessary once you are not. The numbers a supplier considers the answer
   * are almost always in the file, not the message.
   */
  const attachmentText = await attachmentContext(latest?.attachments ?? []);

  const brief = [
    `PRODUCT: ${project.name}`,
    `QUANTITY TIERS: ${project.quantityTiers.join(" / ")}`,
    "",
    "RFQ REQUIREMENTS:",
    ...projectRequirements.slice(0, 40).map((r) => `- ${r.text}`),
    "",
    targets.length > 0
      ? "TARGET PRICES STATED IN THE RFQ DECK THE SUPPLIER ALREADY HAS. Never deny they exist, and never negotiate them:"
      : "",
    ...targets.map((t) => `- ${t}`),
    "",
    facts.length > 0 ? "FACTS ALREADY DECIDED BY THE OPERATOR:" : "",
    ...facts.map((f) => `- ${f}`),
    "",
    `SUPPLIER: ${supplier.companyName}`,
    "",
    "CONVERSATION:",
    ...thread.map(
      (m) => `[${m.direction === "inbound" ? "THEM" : "US"}] ${(m.bodyText ?? "").slice(0, 1500)}`,
    ),
    "",
    attachmentText.length > 0 ? "CONTENTS OF THEIR ATTACHMENTS:" : "",
    ...attachmentText,
    "",
    mandate ? mandateBrief(mandate) : "",
    "",
    latest?.analysis
      ? [
          "TRIAGE OF THEIR LAST MESSAGE:",
          `they asked: ${latest.analysis.questions_from_supplier.join(" | ") || "(nothing)"}`,
          `still missing from them: ${latest.analysis.missing.join(", ") || "(nothing)"}`,
        ].join("\n")
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const stream = new Anthropic().messages.stream({
    model: "claude-opus-5",
    max_tokens: 8000,
    output_config: { effort: "medium", format: zodOutputFormat(ReplyPlan) },
    system: SYSTEM,
    messages: [{ role: "user", content: brief }],
  });

  const response = await stream.finalMessage();
  if (response.stop_reason === "refusal") throw new Error("The model declined to plan a reply");

  const json = response.content.find((b) => b.type === "text")?.text;
  if (!json) throw new Error("No structured output returned");

  const plan = ReplyPlan.parse(JSON.parse(json));
  // Requirement text is quoted from the RFQ and can carry its own long dashes.
  return { ...plan, draft: plan.draft.replace(/[‒-―−]/g, "-").trim() };
}

/**
 * Business hours in China, so a reply does not land at three in the morning.
 *
 * Not a disguise - a company that answers instantly at any hour is simply not
 * how trade works, and mail sent at odd hours is treated worse by filters.
 */
export function withinSupplierHours(now = new Date()): boolean {
  // China Standard Time is UTC+8 year round.
  const hour = (now.getUTCHours() + 8) % 24;
  const day = new Date(now.getTime() + 8 * 3600_000).getUTCDay();
  if (day === 0 || day === 6) return false;
  return hour >= 9 && hour < 18;
}

export interface AutopilotResult {
  replied: { company: string }[];
  /** Drafts the guard refused to let out, with the reason. */
  blocked: { company: string; problems: string[] }[];
  /** Answerable, drafted, not sent - only produced when send is off. */
  readyToSend: { company: string; draft: string }[];
  parked: { company: string; questions: string[] }[];
  heldForHuman: { company: string; reason: string }[];
  waitingOnAnswers: { company: string; questions: number }[];
}

/**
 * Work every conversation that has an unanswered supplier message.
 *
 * A reply goes out only when the plan is answerable and the triage did not
 * flag the message for a person. Everything else is parked with its reason,
 * so the queue is always explicable: nothing is silently dropped and nothing
 * is silently sent.
 */
export async function runAutopilot(
  projectId: string,
  options: { send?: boolean } = {},
): Promise<AutopilotResult> {
  // Parking a question changes nothing outside the building, so it happens on
  // every pass. Sending is the step that needs an explicit act, and it is the
  // only thing this flag controls.
  const send = options.send ?? true;
  const settings = await getSettings();
  const mandate = await loadMandate(projectId);
  const result: AutopilotResult = {
    replied: [],
    blocked: [],
    readyToSend: [],
    parked: [],
    heldForHuman: [],
    waitingOnAnswers: [],
  };

  const pending = await db
    .select({
      id: messages.id,
      supplierId: messages.supplierId,
      company: suppliers.companyName,
      analysis: messages.analysis,
      classification: messages.classification,
    })
    .from(messages)
    .leftJoin(suppliers, eq(messages.supplierId, suppliers.id))
    .where(
      and(
        eq(messages.projectId, projectId),
        eq(messages.direction, "inbound"),
        isNull(messages.handledAt),
      ),
    )
    .orderBy(asc(messages.receivedAt));

  /*
   * One reply per conversation, not per message.
   *
   * A supplier who writes twice before we answer produced two drafts and would
   * have received two emails, which reads as a system talking to itself. The
   * newest message is the one to answer - it is the state of the conversation -
   * and the earlier ones are marked handled because the reply covers them.
   */
  const latestPerSupplier = new Map<string, (typeof pending)[number]>();
  const superseded: string[] = [];
  for (const message of pending) {
    if (!message.supplierId) continue;
    const held = latestPerSupplier.get(message.supplierId);
    if (held) superseded.push(held.id);
    latestPerSupplier.set(message.supplierId, message);
  }
  if (superseded.length > 0) {
    await db
      .update(messages)
      .set({ handledAt: new Date() })
      .where(inArray(messages.id, superseded));
  }

  for (const message of latestPerSupplier.values()) {
    if (!message.supplierId) continue;
    const company = message.company ?? "ספק";

    if (message.classification === "not_relevant") {
      await db.update(messages).set({ handledAt: new Date() }).where(eq(messages.id, message.id));
      continue;
    }

    /*
     * Two different things arrive as "needs a human", and they deserve
     * different handling. A supplier asking a factual question the RFQ left
     * open is a decision made once, which belongs in the queue. A supplier
     * disputing a price or a requirement is a judgement call - and whether the
     * agent may make it is exactly what the autonomy tier decides.
     *
     * At tier 3 the mandate carries a real ceiling, so the same message is work
     * to do rather than a reason to stop. Without a ceiling it is still a stop:
     * negotiating with no walk-away is conceding slowly.
     */
    const isJudgement =
      message.analysis?.challenges_a_requirement === true ||
      message.classification === "quotation";

    if (isJudgement && !mandate.mayNegotiatePrice) {
      result.heldForHuman.push({
        company,
        reason:
          mandate.blockedReason ?? message.analysis?.needs_human_reason ?? "דורש החלטה",
      });
      continue;
    }

    // Even a full mandate runs out. A conversation that has gone round several
    // times is not going to be closed by one more email from a machine.
    if (isJudgement && (await roundsSoFar(projectId, message.supplierId)) >= mandate.maxRounds) {
      result.heldForHuman.push({
        company,
        reason: `${mandate.maxRounds} סבבים בלי סיכום - הועבר אליך`,
      });
      continue;
    }

    // A thread already waiting on a parked question stays put.
    const stillOpen = await db
      .select({ id: openQuestions.id })
      .from(openQuestions)
      .where(
        and(
          eq(openQuestions.projectId, projectId),
          eq(openQuestions.messageId, message.id),
          eq(openQuestions.status, "open"),
        ),
      );

    if (stillOpen.length > 0) {
      result.waitingOnAnswers.push({ company, questions: stillOpen.length });
      continue;
    }

    const plan = await planReply({ projectId, supplierId: message.supplierId }, mandate);

    if (!plan.answerable) {
      for (const question of plan.open_questions) {
        await db.insert(openQuestions).values({
          projectId,
          supplierId: message.supplierId,
          messageId: message.id,
          scope: question.scope,
          questionEn: question.question_en,
          questionHe: question.question_he,
          whyHe: question.why_he,
        });
      }
      result.parked.push({
        company,
        questions: plan.open_questions.map((q) => q.question_he),
      });
      continue;
    }

    /*
     * Read the draft once more before it goes. The mandate is in the prompt and
     * the model follows it, which is not the same as it being impossible to
     * break - and the two things this looks for, a price above the ceiling and
     * a commitment to spend, are the two that cannot be walked back.
     */
    const guard = checkDraft(plan.draft, mandate);
    if (!guard.safe) {
      result.blocked.push({ company, problems: guard.problems });
      continue;
    }

    if (!send) {
      // Answerable and waiting only on the operator pressing send.
      result.readyToSend.push({ company, draft: plan.draft });
      continue;
    }

    if (!settings.sourcingMailbox) throw new Error("חסרה תיבת שליחה בהגדרות");

    await sendReply(projectId, message.supplierId, plan.draft);
    result.replied.push({ company });
  }

  return result;
}

/**
 * Triage every open thread and park what it cannot answer, without sending.
 *
 * Safe to run on every inbox check, and it should be: the questions have to be
 * in front of the operator before anybody wonders why a thread went quiet.
 */
export async function triageAndPark(projectId: string): Promise<AutopilotResult> {
  return runAutopilot(projectId, { send: false });
}

/**
 * Release every thread that was waiting on a question which has now been
 * answered, so the reply goes out without anyone having to remember it did.
 */
export async function releaseAnswered(projectId: string): Promise<AutopilotResult> {
  const blocked = await db
    .select({ messageId: openQuestions.messageId })
    .from(openQuestions)
    .where(and(eq(openQuestions.projectId, projectId), eq(openQuestions.status, "open")));

  const stillBlocked = new Set(blocked.map((b) => b.messageId));

  // Anything previously parked whose questions are all answered is simply an
  // unhandled inbound message again, which is what the main pass handles.
  const parked = await db
    .select({ messageId: openQuestions.messageId })
    .from(openQuestions)
    .where(and(eq(openQuestions.projectId, projectId), eq(openQuestions.status, "answered")));

  const releasable = parked.filter((p) => p.messageId && !stillBlocked.has(p.messageId));
  if (releasable.length === 0) {
    return {
      replied: [],
      blocked: [],
      readyToSend: [],
      parked: [],
      heldForHuman: [],
      waitingOnAnswers: [],
    };
  }

  return runAutopilot(projectId);
}
