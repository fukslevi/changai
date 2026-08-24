/**
 * Tell the existing quote readings which product each line prices.
 *
 * Going forward the extractor answers this while reading the message. What is
 * already stored was extracted before the question was asked, so every gap on
 * a multi-product project is currently measured against whichever target was
 * read last - which is how a $1.50 wheel came out 96% under the budget for a
 * $35 ladder.
 *
 * One model call per project rather than re-reading every attachment: the line
 * names and the item names are all the judgement needs.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import { db, items, projects, quoteReadings } from "../lib/db";

const Matches = z.object({
  matches: z.array(
    z.object({
      line_name: z.string(),
      /** Our exact product name, or null when we never asked for it. */
      rfq_item: z.string().nullable(),
    }),
  ),
});

async function matchNames(
  productName: string,
  itemNames: string[],
  lineNames: string[],
): Promise<Map<string, string | null>> {
  const stream = new Anthropic().messages.stream({
    model: "claude-opus-5",
    max_tokens: 8000,
    output_config: { effort: "medium", format: zodOutputFormat(Matches) },
    system: `Match each quoted line to the product it prices, from our list.

Match on what the thing is, not on wording. A supplier writing "Multi-purpose
(A-frame) telescopic ladder 1.9m+1.9m, 6+6 steps" is quoting an item we called
"A - 12.5FT Aluminum material, telescopic A frame".

Return null for anything we did not ask to be priced - accessories, spare parts,
carry bags, samples, tooling. A wrong match is worse than none: it puts the
price of a $1.50 wheel next to the target for a $35 ladder and reports the
supplier as 96% under budget.

Use our names exactly as given. Return one entry per line name.`,
    messages: [
      {
        role: "user",
        content: [
          `PRODUCT: ${productName}`,
          "",
          "OUR PRODUCTS:",
          ...itemNames.map((n) => `- ${n}`),
          "",
          "QUOTED LINES:",
          ...lineNames.map((n) => `- ${n}`),
        ].join("\n"),
      },
    ],
  });

  const message = await stream.finalMessage();
  const parsed = message.parsed_output as z.infer<typeof Matches> | null;

  const out = new Map<string, string | null>();
  for (const match of parsed?.matches ?? []) {
    out.set(match.line_name, match.rfq_item);
  }
  return out;
}

async function main() {
  for (const project of await db.select().from(projects).orderBy(asc(projects.createdAt))) {
    const itemNames = (await db.select().from(items).where(eq(items.projectId, project.id)))
      .filter((i) => i.kind === "priced_variant")
      .map((i) => i.name);

    if (itemNames.length === 0) {
      console.log(`${project.name}: no priced items, nothing to match`);
      continue;
    }

    const readings = await db
      .select()
      .from(quoteReadings)
      .where(eq(quoteReadings.projectId, project.id));

    const lineNames = [
      ...new Set(readings.flatMap((r) => r.lines.map((l) => l.item_name))),
    ];

    if (lineNames.length === 0) {
      console.log(`${project.name}: no quoted lines`);
      continue;
    }

    console.log(`\n${project.name}: ${lineNames.length} distinct line names`);
    const matches = await matchNames(project.name, itemNames, lineNames);

    for (const [lineName, itemName] of matches) {
      console.log(`  ${lineName.slice(0, 58).padEnd(58)} -> ${itemName ?? "(not ours)"}`);
    }

    for (const reading of readings) {
      const updated = reading.lines.map((line) => ({
        ...line,
        matches_rfq_item: matches.get(line.item_name) ?? null,
      }));
      await db
        .update(quoteReadings)
        .set({ lines: updated })
        .where(eq(quoteReadings.id, reading.id));
    }

    console.log(`  ${readings.length} readings updated`);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
