import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

/**
 * Score candidates against what the RFQ actually asks for.
 *
 * Scoring is what turns a search-results dump into a shortlist somebody can
 * approve. Every score carries a rationale, because a number on its own gives
 * the operator nothing to disagree with - and disagreeing is the point of the
 * approval gate.
 */

const Scored = z.object({
  results: z.array(
    z.object({
      domain: z.string(),
      /** 0-100. Anything under 40 is not worth an email. */
      score: z.number(),
      /** One sentence, specific to this company. Shown next to the score. */
      rationale: z.string(),
      /** Best guess at the legal company name from the site text. */
      companyName: z.string(),
      country: z.string().nullable(),
      /** True when the site sells finished goods rather than manufacturing. */
      looksLikeReseller: z.boolean(),
    }),
  ),
});

export interface Candidate {
  domain: string;
  title: string;
  snippet: string;
  matchedQueries: string[];
  companyText: string;
}

export async function scoreCandidates(
  productName: string,
  requirements: string[],
  candidates: Candidate[],
): Promise<z.infer<typeof Scored>["results"]> {
  if (candidates.length === 0) return [];
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set");

  const client = new Anthropic();

  const brief = [
    `PRODUCT WE ARE SOURCING: ${productName}`,
    "",
    "KEY REQUIREMENTS:",
    ...requirements.slice(0, 25).map((r) => `- ${r}`),
    "",
    "CANDIDATES:",
    ...candidates.map((c, i) =>
      [
        `[${i + 1}] ${c.domain}`,
        `title: ${c.title}`,
        `matched searches: ${c.matchedQueries.join(" | ")}`,
        `snippet: ${c.snippet}`,
        `site text: ${c.companyText.slice(0, 1200) || "(none retrieved)"}`,
      ].join("\n"),
    ),
  ].join("\n");

  const stream = client.messages.stream({
    model: "claude-opus-5",
    max_tokens: 16000,
    output_config: { effort: "medium", format: zodOutputFormat(Scored) },
    system: `You screen candidate suppliers for a consumer-products company sourcing from China.

Score each candidate 0-100 on how likely it is to MANUFACTURE the product described.

Score high: the company's own site shows it produces this category or an
adjacent one with the same processes and materials; it mentions OEM/ODM, factory
area, production lines, export experience or certifications.

Score low: trading companies and resellers with no production of their own;
retailers; sites about a different product category; blogs, news and directories.
Set looksLikeReseller when the site sells finished goods rather than making them.

An adjacent manufacturer often scores well - a factory producing steel wire
baskets can make a bike basket. Judge the process and materials, not the exact
product name.

The rationale must cite something concrete from that specific site. "Looks
relevant" is useless to the person deciding whether to email them.

Return one entry per candidate, using the exact domain given.`,
    messages: [{ role: "user", content: brief }],
  });

  const response = await stream.finalMessage();
  if (response.stop_reason === "refusal") throw new Error("The model declined to score");

  const json = response.content.find((b) => b.type === "text")?.text;
  if (!json) throw new Error("No structured output returned");

  return Scored.parse(JSON.parse(json)).results;
}
