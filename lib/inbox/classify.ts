/**
 * Read a supplier reply and say what it is, what it answered, and what it did
 * not.
 *
 * The classification drives everything downstream: whether the operator is
 * notified, whether a follow-up goes out on its own, and whether the thread is
 * closed. The gap list is the part that earns its keep - a factory that quotes a
 * price but never states MOQ or lead time has not given you a comparable
 * quotation, and noticing that by hand across a dozen threads is exactly the
 * work this is meant to remove.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

export const ReplyAnalysis = z.object({
  classification: z.enum([
    /** Contains actual prices, or an attachment that plainly is the quote. */
    "quotation",
    /** Willing to quote but asking us something first. */
    "interested_needs_info",
    /** Can make it, has not priced it yet - a holding reply. */
    "acknowledged",
    /** Cannot or will not supply. */
    "declined",
    /** Auto-reply, wrong recipient, spam, out of office. */
    "not_relevant",
  ]),
  /** One line in Hebrew for the operator - what this reply actually says. */
  summary_he: z.string(),
  /** Anything the supplier asked us. Empty when they asked nothing. */
  questions_from_supplier: z.array(z.string()).default([]),
  /** RFQ points they answered, quoted from their own words. */
  answered: z.array(z.string()).default([]),
  /** Required facts still missing. These drive the automatic follow-up. */
  missing: z
    .array(
      z.enum([
        "unit_price",
        "moq",
        "lead_time",
        "payment_terms",
        "sample_price",
        "certificates",
        "product_photos",
        "tooling_cost",
        "incoterm",
        "carton_dimensions",
      ]),
    )
    .default([]),
  /**
   * The supplier says a requirement is wrong, impossible, or based on a bad
   * benchmark. Never auto-answered - a challenge is often correct.
   */
  challenges_a_requirement: z.boolean(),
  challenge_detail: z.string().nullable(),
  /** True when a human should read this before anything else happens. */
  needs_human: z.boolean(),
  needs_human_reason: z.string().nullable(),
});

export type ReplyAnalysis = z.infer<typeof ReplyAnalysis>;

const SYSTEM = `You triage supplier replies for a consumer-products company sourcing from China.

You are given the RFQ requirements that were sent, and one reply from a factory.
Report what the reply is and what it still leaves open.

CLASSIFICATION
- quotation: contains prices, or clearly attaches the quote. A price for even
  one quantity tier counts.
- interested_needs_info: willing, but asking us a question first.
- acknowledged: says they can make it, no prices yet.
- declined: cannot or will not supply.
- not_relevant: auto-reply, out of office, wrong address, marketing spam.

MISSING
List only what the RFQ asked for and the reply does not contain. Do not list a
field the supplier answered in an attachment they describe. Be strict about
unit_price: "we can offer a good price" is not a price.

CHALLENGES
Set challenges_a_requirement when the supplier says a specification is wrong,
unachievable, or based on a false premise - for example that a stated wattage
does not exist at that price, or that a carton size breaks a warehouse limit.
These are often correct and valuable. Never treat one as a rejection.

NEEDS_HUMAN
Set it for: any challenge to a requirement, any negotiation over price or
quantity, any proposed change to the specification, anything about samples,
tooling or commitments, and anything you are unsure how to read.

Write summary_he in Hebrew, one sentence, factual. Use a short hyphen (-), never
a long dash.`;

export async function analyseReply(
  productName: string,
  requirements: string[],
  reply: { fromAddress: string; subject: string; bodyText: string; attachments: string[] },
): Promise<{ analysis: ReplyAnalysis; usage: unknown }> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set");

  const brief = [
    `PRODUCT: ${productName}`,
    "",
    "WHAT THE RFQ ASKED FOR:",
    ...requirements.slice(0, 40).map((r) => `- ${r}`),
    "",
    `REPLY FROM: ${reply.fromAddress}`,
    `SUBJECT: ${reply.subject}`,
    `ATTACHMENTS: ${reply.attachments.join(", ") || "(none)"}`,
    "",
    "BODY:",
    reply.bodyText.slice(0, 12_000),
  ].join("\n");

  const stream = new Anthropic().messages.stream({
    model: "claude-opus-5",
    max_tokens: 8000,
    output_config: { effort: "medium", format: zodOutputFormat(ReplyAnalysis) },
    system: SYSTEM,
    messages: [{ role: "user", content: brief }],
  });

  const response = await stream.finalMessage();
  if (response.stop_reason === "refusal") throw new Error("The model declined to classify");

  const json = response.content.find((b) => b.type === "text")?.text;
  if (!json) throw new Error("No structured output returned");

  return { analysis: ReplyAnalysis.parse(JSON.parse(json)), usage: response.usage };
}
