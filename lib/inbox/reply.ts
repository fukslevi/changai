/**
 * Draft and send a reply on an existing supplier thread.
 *
 * The draft is a suggestion, never an automatic send. Chasing a missing MOQ is
 * safe enough to write for you; deciding whether a factory that called your
 * target price too low is worth pursuing is not, and the same text box has to
 * serve both. So the model writes, the operator reads, and only a person clicks
 * send.
 */
import Anthropic from "@anthropic-ai/sdk";
import { and, asc, eq } from "drizzle-orm";
import { and as andOp } from "drizzle-orm";
import { db, items, messages, openQuestions, outreach, projects, requirements, suppliers } from "../db";
import { messageIdHeaderOf, sendEmail } from "../mail/gmail";
import { attachmentSummary } from "../quotes/context";
import { getSettings } from "../settings";

export { GAP_LABELS } from "./labels";

const SYSTEM = `You write replies to Chinese manufacturers on behalf of a consumer-products
company sourcing for Amazon US.

Write the body only - no subject line, no signature block. A signature is added
afterwards.

LENGTH - THIS IS THE HARD RULE
Six sentences at most, and fewer is better. A factory sales desk reads these on
a phone between other enquiries, and a long mail gets the reply "we will check
and revert" or no reply at all.

There is one goal: their price at our quantities. Everything else in the mail
competes with it.

- Never number more than three things. Eight numbered asks reliably produced
  two answers; the ones at the bottom were simply not read.
- Do not restate the specification, the quantities, the packaging or the
  certification. They have the RFQ, and repeating it says we think they did not
  read it.
- Do not recap what they said before asking. Answer, ask, stop.
- Do not explain our programme, our SKUs or which one leads. It changes nothing
  they do.
- Details that matter only once a supplier is in contention - carton
  dimensions, tooling, sample cost - are asked after there is a price worth
  pursuing, never in the same breath as the price.

RULES
- Plain text. Short lines. No markdown, no bullets with asterisks.
- Use a short hyphen (-). Never a long dash.
- Answer their questions first, then ask for what is missing.
- Never invent a specification, a price, a quantity or a commitment that is not
  in the material you were given. If a question cannot be answered from the RFQ,
  say the operator will confirm and leave a clearly marked placeholder in square
  brackets.
- Never negotiate price. Never promise an order, a timeline or a sample.
- Courteous and brief. These are busy sales people reading on a phone.`;

export interface DraftContext {
  projectId: string;
  supplierId: string;
}

export async function draftReply({ projectId, supplierId }: DraftContext): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set");

  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) throw new Error("Project not found");

  const [supplier] = await db.select().from(suppliers).where(eq(suppliers.id, supplierId));
  if (!supplier) throw new Error("Supplier not found");

  const thread = await db
    .select()
    .from(messages)
    .where(and(eq(messages.projectId, projectId), eq(messages.supplierId, supplierId)))
    .orderBy(asc(messages.receivedAt));

  const projectRequirements = await db
    .select({ text: requirements.text })
    .from(requirements)
    .where(eq(requirements.projectId, projectId));

  // The deck the supplier is holding states target prices. Drafting without
  // them produced a reply telling a factory no target price had been sent.
  const projectItems = await db.select().from(items).where(eq(items.projectId, projectId));
  const targets = projectItems
    .filter((i) => i.targetPrices.length > 0)
    .map(
      (i) =>
        `${i.name}: ` +
        i.targetPrices.map((t) => `${t.qty ?? "?"} pcs at $${t.unit_price ?? "?"}`).join(", "),
    );

  const latest = [...thread].reverse().find((m) => m.direction === "inbound");
  const analysis = latest?.analysis;

  // Same view of the attachments the autopilot has - the extracted reading
  // rather than the files. Drafting with no view of them at all produced a
  // reply telling a supplier we had never received the quotation they sent.
  const attachments = await attachmentSummary(projectId, supplierId, latest?.attachments ?? []);

  /*
   * Decisions already made on this project. The autopilot had these and the
   * manual drafter did not, so a hand-written reply could contradict an answer
   * the operator had given days earlier - quoting steel back at a supplier
   * after we had settled on aluminium.
   */
  const decided = await db
    .select()
    .from(openQuestions)
    .where(
      andOp(eq(openQuestions.projectId, projectId), eq(openQuestions.status, "answered")),
    );
  const facts = decided
    .filter((q) => q.answer)
    .map((q) => `${q.questionEn} -> ${q.answer as string}`);

  const brief = [
    `PRODUCT: ${project.name}`,
    `QUANTITY TIERS: ${project.quantityTiers.join(" / ")}`,
    "",
    "RFQ REQUIREMENTS (the only facts you may state):",
    ...projectRequirements.slice(0, 40).map((r) => `- ${r.text}`),
    "",
    targets.length > 0
      ? "TARGET PRICES IN THE RFQ DECK THE SUPPLIER ALREADY HAS. Never deny they exist, and never negotiate them:"
      : "",
    ...targets.map((t) => `- ${t}`),
    "",
    facts.length > 0 ? "FACTS ALREADY DECIDED BY THE OPERATOR - these override the RFQ text:" : "",
    ...facts.map((f) => `- ${f}`),
    "",
    `SUPPLIER: ${supplier.companyName}`,
    "",
    "CONVERSATION SO FAR:",
    ...thread.map(
      (m) =>
        `[${m.direction === "inbound" ? "THEM" : "US"}] ${(m.bodyText ?? "").slice(0, 1500)}`,
    ),
    "",
    "",
    analysis
      ? [
          "TRIAGE OF THEIR LAST MESSAGE:",
          `questions they asked: ${analysis.questions_from_supplier.join(" | ") || "(none)"}`,
          `still missing from them: ${analysis.missing.join(", ") || "(nothing)"}`,
          analysis.challenges_a_requirement
            ? `they challenged a requirement: ${analysis.challenge_detail ?? ""}`
            : "",
        ].join("\n")
      : "",
    "",
    "Write the reply.",
  ].join("\n");

  const stream = new Anthropic().messages.stream({
    model: "claude-opus-5",
    max_tokens: 4000,
    output_config: { effort: "medium" },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          { type: "text" as const, text: brief },
          ...(attachments.length > 0
            ? [{ type: "text" as const, text: "CONTENTS OF THEIR ATTACHMENTS:" }, ...attachments]
            : []),
        ],
      },
    ],
  });

  const response = await stream.finalMessage();
  const text = response.content.find((b) => b.type === "text")?.text ?? "";

  // Requirement text is quoted from the RFQ and can carry its own long dashes.
  return text.replace(/[‒-―−]/g, "-").trim();
}

export interface ReplyResult {
  messageId: string;
  threadId: string;
}

/**
 * Sign-offs the model writes despite being told not to, plus any name after.
 *
 * Anchored to the end and required to start on its own line, so a "thanks" in
 * the middle of a sentence survives - "thanks for the photos, could you also
 * send the price" must not lose its second half.
 */
const SIGN_OFF =
  /\n+[ \t]*(best regards|kind regards|warm regards|regards|thanks and regards|many thanks|thank you|thanks|sincerely|yours sincerely|best wishes|best)[ \t]*[,.!]?[ \t]*(\n[^\n]{0,60}){0,4}\s*$/i;

export function stripSignOff(body: string): string {
  let text = body.trim();
  // Twice, because "Thanks,\nShlomi\n\nBest regards," happens.
  for (let i = 0; i < 2; i++) {
    const next = text.replace(SIGN_OFF, "").trim();
    if (next === text) break;
    text = next;
  }
  return text;
}

/** Send the operator's text back onto the supplier's own thread. */
export async function sendReply(
  projectId: string,
  supplierId: string,
  body: string,
  options: { kind?: "reply" | "chase" | "price_ask" } = {},
): Promise<ReplyResult> {
  const [supplier] = await db.select().from(suppliers).where(eq(suppliers.id, supplierId));
  if (!supplier?.email) throw new Error("לספק אין כתובת מייל");

  const [row] = await db
    .select()
    .from(outreach)
    .where(and(eq(outreach.projectId, projectId), eq(outreach.supplierId, supplierId)))
    .limit(1);

  if (!row?.gmailThreadId) throw new Error("אין שרשור פתוח מול הספק הזה");

  const thread = await db
    .select()
    .from(messages)
    .where(and(eq(messages.projectId, projectId), eq(messages.supplierId, supplierId)))
    .orderBy(asc(messages.receivedAt));

  const latestInbound = [...thread].reverse().find((m) => m.direction === "inbound");
  const settings = await getSettings();

  // Reply to the address that actually wrote to us. The contact page address and
  // the sales person who picks the enquiry up are frequently not the same
  // mailbox, and answering the wrong one restarts the conversation.
  const replyTo = latestInbound?.fromAddress
    ? (latestInbound.fromAddress.match(/<([^>]+)>/)?.[1] ?? latestInbound.fromAddress)
    : supplier.email;

  const inReplyTo = latestInbound
    ? await messageIdHeaderOf(latestInbound.gmailMessageId)
    : null;

  const signature = `\n\nBest regards,\n${settings.senderName}\n${settings.senderTitle}\n${settings.companyName}`;

  /*
   * Answer in the conversation they wrote in, not the one we opened.
   *
   * These are usually the same thread, and were assumed to be. They are not
   * when the supplier's colleague forwards the enquiry internally and the
   * salesperson replies to the forward: Gmail gives that a new threadId, and a
   * reply addressed to the original lands in a conversation the supplier is not
   * reading. Sureall's Kevin asked whether UL and SGS were mandatory, got a
   * correct answer twenty-two minutes later, and saw silence for fourteen hours
   * because the answer was filed under a thread he had never seen.
   *
   * The subject follows theirs for the same reason: clients that thread on the
   * subject line rather than on headers need to see their own "Re: Fw: ..." to
   * keep it together.
   */
  const baseSubject = latestInbound?.subject ?? row.subject;
  const subject = baseSubject.startsWith("Re: ") ? baseSubject : `Re: ${baseSubject}`;
  const threadId = latestInbound?.gmailThreadId ?? row.gmailThreadId;

  const result = await sendEmail({
    to: replyTo,
    subject,
    body: `${stripSignOff(body)}${signature}`,
    fromName: `${settings.senderName} | ${settings.companyName}`,
    threadId,
    ...(inReplyTo ? { inReplyTo, references: inReplyTo } : {}),
  });

  await db
    .insert(messages)
    .values({
      projectId,
      supplierId,
      direction: "outbound",
      gmailMessageId: result.messageId,
      gmailThreadId: result.threadId,
      fromAddress: settings.sourcingMailbox,
      subject,
      bodyText: body.trim(),
      outboundKind: options.kind ?? "reply",
      receivedAt: new Date(),
    })
    .onConflictDoNothing();

  // Replying is dealing with it. Anything still open resurfaces on their answer.
  if (latestInbound) {
    await db
      .update(messages)
      .set({ handledAt: new Date() })
      .where(eq(messages.id, latestInbound.id));
  }

  return result;
}
