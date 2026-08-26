import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

/**
 * Search angles invented from the product, once the generic ones run out.
 *
 * The fixed suffix list - "OEM factory", "wholesale supplier China" - is the
 * same twelve phrases for every product, and it is the wrong shape for the job:
 * a factory names itself by what it makes and how, not by the words a buyer
 * uses. "telescopic ladder OEM factory" finds the same companies as page one
 * did, while "aluminium extrusion ladder manufacturer" and "EN131 ladder
 * factory" reach a different set entirely.
 *
 * Generated once per project and stored, because they depend on the product
 * rather than on anything that changes between runs.
 */

const Angles = z.object({
  angles: z
    .array(
      z.object({
        /** The search phrase, in English, without the product name repeated. */
        query: z.string(),
        /** Why this reaches manufacturers the plain product term misses. */
        reason: z.string(),
      }),
    )
    .max(14),
});

export type SearchAngle = z.infer<typeof Angles>["angles"][number];

export async function generateAngles(
  productName: string,
  keywords: string[],
  requirements: string[],
  /** Queries already tried, so a second batch is genuinely new ground. */
  avoid: string[] = [],
): Promise<SearchAngle[]> {
  const client = new Anthropic();

  const stream = client.messages.stream({
    model: "claude-opus-5",
    max_tokens: 4000,
    output_config: { effort: "medium", format: zodOutputFormat(Angles) },
    system: `You write web search queries that surface Chinese manufacturers of a specific product.

The buyer has already searched the obvious terms and got page after page of
retailers and Amazon listings. Your queries must reach the factories those
retailers buy from.

What works:
- The material and process a factory would name on its own site: "aluminium
  extrusion", "powder coated steel wire", "injection moulded ABS", "die casting".
- The component or sub-assembly, which is often a different factory: "ladder
  hinge manufacturer", "LED driver factory".
- The industry standard or certification a maker would advertise: "EN131",
  "ANSI ladder", "IP65 work light", "CE RoHS".
- The Chinese manufacturing cluster for the category: "Zhongshan lighting",
  "Yongkang hardware", "Ningbo bicycle parts", "Foshan furniture".
- The trade name the industry uses rather than the consumer name: a "work light"
  is a "portable floodlight" or "site lamp" in the trade.

What does not: repeating the product term with "cheap", "best", "buy", "supplier
near me", or any phrase a shopper would type. Do not include the country name in
every query - one or two is enough, the rest should be specific enough that only
factories rank.

Each query is a standalone search string. It may include the product term if
that helps, but the value is in the part that is not the product term.

Return 10-14 angles, ordered by how likely each is to reach a real factory.

If a list of queries already tried is given, none of yours may repeat them or be
a trivial rewording of one. Go somewhere else: a different material, a different
sub-assembly, a different manufacturing cluster, the term a different national
market uses. Running out of genuinely new angles is a real answer - returning
five good ones is better than padding to fourteen with variations.`,
    messages: [
      {
        role: "user",
        content: [
          `PRODUCT: ${productName}`,
          `BUYER'S KEYWORDS: ${keywords.join(", ")}`,
          requirements.length > 0
            ? `SPECIFICATION (for materials, standards and processes):\n${requirements.slice(0, 40).join("\n")}`
            : "SPECIFICATION: not available",
        ].join("\n\n"),
      },
    ],
  });

  const message = await stream.finalMessage();
  const json = message.content.find((block) => block.type === "text")?.text;
  if (!json) return [];

  try {
    return Angles.parse(JSON.parse(json)).angles;
  } catch {
    return [];
  }
}
