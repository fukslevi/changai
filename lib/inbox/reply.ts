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
import { attachmentBlocks } from "../quotes/context";
import { getSettings } from "../settings";

export { GAP_LABELS } from "./labels";

const SYSTEM = `You write replies to Chinese manufacturers on behalf of a consumer-products
company sourcing for Amazon US.

Write the body only - no subject line, no signature block. A signature is added
afterwards.

RULES
- Plain text. Short lines. No markdown, no bullets with asterisks.
- Use a short hyphen (-). Never a long dash.
- Numbered list when asking for more than two things.
- Address exactly what their message said. Do not restate the whole RFQ.
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

  // Same view of the attachments the autopilot has. Drafting without them
  // produced a reply telling a supplier we had never received the quotation
  // they had in fact sent.
  const attachments = await attachmentBlocks(latest?.attachments ?? []);

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

/** Send the operator's text back onto the supplier's own thread. */
export async function sendReply(
  projectId: string,
  supplierId: string,
  body: string,
  options: { kind?: "reply" | "chase" } = {},
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
  const subject = row.subject.startsWith("Re: ") ? row.subject : `Re: ${row.subject}`;

  const result = await sendEmail({
    to: replyTo,
    subject,
    body: `${body.trim()}${signature}`,
    fromName: `${settings.senderName} | ${settings.companyName}`,
    threadId: row.gmailThreadId,
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
