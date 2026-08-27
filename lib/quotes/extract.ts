/**
 * Pull a supplier's numbers out of whatever they sent, and keep them.
 *
 * Every quote is recorded, including the ones that cannot work. A factory that
 * says the target is unreachable even at double the price has told you
 * something the shortlist needs: where the real floor is. Discarding it because
 * it fails the rule leaves you comparing only the suppliers who said yes, which
 * is the set least likely to contain the honest number.
 *
 * What they proposed is recorded too. A supplier who quotes a cheaper gauge, a
 * different coating or a smaller carton has not quoted your product - and the
 * difference is the reason their price looks better.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

export const ExtractedQuote = z.object({
  /** False when the message is a refusal, a question, or has no numbers. */
  has_pricing: z.boolean(),
  currency: z.string().default("USD"),
  /** As stated by the supplier - FOB, EXW, CIF, DDP, or null if unclear. */
  incoterm: z.string().nullable(),
  /** The port or place attached to the incoterm, when they name one. */
  incoterm_place: z.string().nullable(),

  lines: z
    .array(
      z.object({
        /** Their wording, kept verbatim. */
        item_name: z.string(),
        /**
         * Which of our RFQ products this line prices, by our exact name.
         *
         * The comment here used to say matching happened later, and it never
         * did: the comparison keyed targets by quantity alone, so on an RFQ
         * with two products every line was measured against whichever target
         * was read last. An accessory priced at $0.54 came out 93% under
         * budget against a $8.05 basket.
         *
         * It cannot be done later by string matching either. "Multi-purpose
         * (A-frame) telescopic ladder 1.9m+1.9m" is our "A - 12.5FT Aluminum
         * material, telescopic A frame", and no amount of substring logic gets
         * there. It is a judgement about what the thing is, made here where
         * the specification and their message are both in view.
         *
         * Empty when the line is an accessory, a sample, a tooling charge or
         * anything else we did not ask to be priced. Empty is the right answer
         * far more often than a guess is.
         *
         * A plain string rather than a nullable one, and that is not a style
         * choice. The API refuses a schema with more than sixteen union-typed
         * parameters, and adding this as `.nullable()` made seventeen - so
         * every extraction failed the moment it was introduced, quietly, into
         * an errors array nobody was reading. Three projects took replies
         * containing prices and produced no quotes at all.
         *
         * Empty string carries the same meaning at no schema cost.
         */
        matches_rfq_item: z.string().default(""),
        /** Null when the price is flat across volumes. */
        qty: z.number().int().positive().nullable(),
        unit_price: z.number().nullable(),
        /** Anything about this line that differs from what we specified. */
        spec_note: z.string().nullable(),
      }),
    )
    .default([]),

  moq: z.number().int().positive().nullable(),
  lead_time_days: z.number().int().positive().nullable(),
  payment_terms: z.string().nullable(),
  sample_price: z.number().nullable(),
  sample_lead_time_days: z.number().int().positive().nullable(),
  tooling_cost: z.number().nullable(),
  certificates: z.array(z.string()).default([]),

  /** Packing, which drives freight and therefore the landed cost. */
  units_per_carton: z.number().int().positive().nullable(),
  carton_dimensions_cm: z.string().nullable(),
  carton_gross_weight_kg: z.number().nullable(),

  /**
   * Where the supplier says our specification cannot be met, or where their
   * offer differs from it. Recorded even when they are declining.
   */
  deviations: z
    .array(
      z.object({
        our_requirement: z.string(),
        what_they_offer: z.string(),
        their_reason: z.string().nullable(),
      }),
    )
    .default([]),

  /** True when they say the target price is unachievable, at any price. */
  rejects_target_price: z.boolean(),
  /** Their own words on why, quoted. Null when they gave none. */
  price_objection: z.string().nullable(),

  /** One line in Hebrew for the comparison table. */
  summary_he: z.string(),
});

export type ExtractedQuote = z.infer<typeof ExtractedQuote>;

const SYSTEM = `You read supplier replies for a company sourcing consumer products from
China, and record what they quoted.

Record what is there. Do not infer a price from a range, do not convert
currencies, do not fill a field because it is usually present. A missing number
is null - it is the thing the follow-up will ask for, and a guess hides it.

PRICING
Take prices exactly as written, per unit. If one price covers several
quantities, record one line per quantity with the same price and note it. If
they quote a total rather than a unit price, leave unit_price null and put the
total in spec_note.

DEVIATIONS
This is the part that matters most. Any place their offer differs from our
specification - a different material, gauge, coating, size, carton, or scope -
goes in deviations with their reason if they gave one. A cheaper price for a
different product is not a cheaper price.

REJECTION
Set rejects_target_price when they say our target cannot be met. Record their
words in price_objection. Still fill in every number they did give: a supplier
who declines has usually told you where the real floor is, and that is worth
more than a quote from someone who agreed to everything.

For every priced line, set matches_rfq_item to the exact name of the product of
ours it is quoting, from the list given. Match on what the thing is, not on
wording: a supplier writing "Multi-purpose (A-frame) telescopic ladder
1.9m+1.9m, 6+6 steps" is quoting an item we called "A - 12.5FT Aluminum
material, telescopic A frame".

Set it to null for anything we did not ask to be priced - accessories, spare
parts, carry bags, samples, tooling. A wrong match is worse than none: it puts
the price of a $1.50 wheel next to the target for a $35 ladder and reports the
supplier as 96% under budget.

Write summary_he in Hebrew, one factual sentence. Short hyphen (-), never long.`;

export async function extractQuote(
  productName: string,
  requirements: string[],
  message: { fromAddress: string; subject: string; bodyText: string },
  attachments: Anthropic.Messages.ContentBlockParam[] = [],
  itemNames: string[] = [],
): Promise<{ quote: ExtractedQuote; usage: unknown }> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set");

  const brief = [
    `PRODUCT: ${productName}`,
    "",
    ...(itemNames.length > 0
      ? [
          "OUR PRODUCTS (use these exact names in matches_rfq_item):",
          ...itemNames.map((n) => `- ${n}`),
          "",
        ]
      : []),
    "WHAT WE SPECIFIED:",
    ...requirements.slice(0, 40).map((r) => `- ${r}`),
    "",
    `FROM: ${message.fromAddress}`,
    `SUBJECT: ${message.subject}`,
    "",
    "BODY:",
    message.bodyText.slice(0, 12_000),
  ].join("\n");

  const stream = new Anthropic().messages.stream({
    model: "claude-opus-5",
    max_tokens: 12_000,
    output_config: { effort: "medium", format: zodOutputFormat(ExtractedQuote) },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          { type: "text" as const, text: brief },
          ...(attachments.length > 0
            ? [{ type: "text" as const, text: "THEIR ATTACHMENTS:" }, ...attachments]
            : []),
        ],
      },
    ],
  });

  const response = await stream.finalMessage();
  if (response.stop_reason === "refusal") throw new Error("The model declined to extract");

  const json = response.content.find((b) => b.type === "text")?.text;
  if (!json) throw new Error("No structured output returned");

  return { quote: ExtractedQuote.parse(JSON.parse(json)), usage: response.usage };
}
