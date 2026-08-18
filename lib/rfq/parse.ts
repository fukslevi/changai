import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { RfqExtraction } from "./extraction-schema";

/**
 * Every rule below was written against a real RFQ that broke an earlier
 * assumption. Do not "simplify" them away — each one has a document behind it.
 */
const SYSTEM = `You read sourcing RFQ documents for a consumer-products company
and extract them into structured data. The documents are slide decks or Word
files exported to PDF, with a consistent section structure but requirements
written as prose bullets.

QUANTITY TIERS
Read the tiers from the document's own pricing table. They vary per project —
one RFQ uses 500/1000/1500, another 500/1500/2500. Never assume a default and
never carry tiers over from one item to another unless the document does.
If the document states no quantities at all, return an empty array and raise
missing_quantity_tiers.

ITEMS
- priced_variant     — has its own target-price table
- bundled_component  — full specification but no price of its own; ships inside
                       a priced item (set parent_item_name)
- optional_addon     — described as "to consider" / "check the option" / not yet
                       committed
A component with a full specification slide and no pricing is normally a
bundled_component. Only classify it as priced_variant if the document treats it
as separately ordered — and then raise priced_variant_without_target_price.

REQUIREMENTS
- Quote the source text verbatim. Do not paraphrase, merge or tidy bullets.
- is_mandatory is inferred from the document's own language: "must", "should
  meet", "important", and plain specification bullets are mandatory; "to
  consider", "check the option", "if possible" are not.
- category "quality_issue" is for defects from a PREVIOUS production run that
  the supplier must avoid (e.g. weld quality with photos of rejected parts).
  These are not ordinary specifications and matter more than most.
- Keys are uppercase and stable, e.g. REQ_BASKET_MATERIAL, REQ_PACKAGING_CARTON.
- Put packaging, certification, insert/manual and logo requirements in
  shared_requirements unless the document scopes them to one item.

VALIDATION ISSUES
Report problems with the RFQ itself. Real examples from this company's own
documents: a packaging slide reading "Carton Box for Director Chair" — text left
over from a different project (foreign_product_name); four accessories given
full specification slides and then omitted from every pricing table. Also flag
missing dimensions, missing materials, and missing product photos: a marketplace
will reject the posting without them, and suppliers cannot quote accurately.

Extract only what the document states. Never invent a dimension, material,
weight or price that is not written there.`;

export interface ParseOptions {
  filename: string;
  mimeType: string;
  content: Buffer;
}

export async function parseRfq({ filename, mimeType, content }: ParseOptions) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set — add it to .env");
  }
  if (mimeType !== "application/pdf") {
    throw new Error(
      `Only PDF is supported right now (got ${mimeType}). Export the deck to PDF and re-upload.`,
    );
  }

  const client = new Anthropic();

  // Streamed, not `messages.parse()`: an image-heavy RFQ plus a 32k output
  // budget is exactly the shape the SDK refuses to run non-streaming, since it
  // could outlive the request timeout. `output_config.format` still guarantees
  // the response is a single JSON text block matching the schema.
  const stream = client.messages.stream({
    model: "claude-opus-5",
    // Opus 5 thinks by default and max_tokens caps thinking + output together,
    // so leave real headroom or long RFQs truncate mid-extraction.
    max_tokens: 32000,
    output_config: {
      effort: "high",
      format: zodOutputFormat(RfqExtraction),
    },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: content.toString("base64"),
            },
            title: filename,
          },
          {
            type: "text",
            text: `Extract this RFQ. Work through it section by section and read the
pricing tables carefully — the quantity tiers and target prices come from there
and nowhere else.`,
          },
        ],
      },
    ],
  });

  const response = await stream.finalMessage();

  if (response.stop_reason === "refusal") {
    throw new Error("The model declined to process this document");
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error("Extraction was truncated — the RFQ is longer than the token budget");
  }

  const json = response.content.find((block) => block.type === "text")?.text;
  if (!json) throw new Error("The model returned no structured output");

  return {
    extraction: RfqExtraction.parse(JSON.parse(json)),
    usage: response.usage,
  };
}
