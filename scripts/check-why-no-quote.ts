/**
 * Why the suppliers who answered did not quote.
 *
 * The quote rate is the stage that matters and the one nobody has looked at
 * directly: a reply that produces no number is a supplier who read the RFQ,
 * decided to engage, and then stopped. Whatever stopped them is written in
 * their own message, and generic advice about outreach cannot see it.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { and, asc, eq } from "drizzle-orm";
import { db, messages, projects, quoteReadings, suppliers } from "../lib/db";

const Analysis = z.object({
  suppliers: z.array(
    z.object({
      company: z.string(),
      /** One of: asked_a_question, price_too_low, wrong_product, wants_more_detail,
       *  stalling, moq_or_volume, no_clear_reason */
      blocker: z.string(),
      /** Their own words, trimmed. */
      evidence: z.string(),
      /** What would most likely have got a number out of them. */
      what_would_have_worked: z.string(),
    }),
  ),
  /** Hebrew. The pattern across all of them, and what to change. */
  recommendation_he: z.string(),
});

async function main() {
  const cases: string[] = [];

  for (const project of await db.select().from(projects).orderBy(asc(projects.createdAt))) {
    if (project.archivedAt) continue;

    const inbound = await db
      .select({
        supplierId: messages.supplierId,
        company: suppliers.companyName,
        body: messages.bodyText,
        cls: messages.classification,
        at: messages.receivedAt,
      })
      .from(messages)
      .leftJoin(suppliers, eq(messages.supplierId, suppliers.id))
      .where(and(eq(messages.projectId, project.id), eq(messages.direction, "inbound")))
      .orderBy(asc(messages.receivedAt));

    const readings = await db
      .select()
      .from(quoteReadings)
      .where(eq(quoteReadings.projectId, project.id));

    const priced = new Set(
      readings.filter((r) => r.lines.some((l) => l.unit_price !== null)).map((r) => r.supplierId),
    );

    const bySupplier = new Map<string, { company: string; texts: string[] }>();
    for (const m of inbound) {
      if (!m.supplierId || priced.has(m.supplierId)) continue;
      const held = bySupplier.get(m.supplierId) ?? { company: m.company ?? "?", texts: [] };
      held.texts.push((m.body ?? "").slice(0, 900));
      bySupplier.set(m.supplierId, held);
    }

    for (const [, info] of bySupplier) {
      cases.push(
        `PROJECT: ${project.name}\nSUPPLIER: ${info.company}\n${info.texts.join("\n---\n")}`,
      );
    }
  }

  console.log(`${cases.length} suppliers replied without ever quoting\n`);
  if (cases.length === 0) process.exit(0);

  const stream = new Anthropic().messages.stream({
    model: "claude-opus-5",
    max_tokens: 12_000,
    output_config: { effort: "high", format: zodOutputFormat(Analysis) },
    system: `You are diagnosing why factories that replied to an RFQ never sent a price.

For each supplier, classify what actually stopped them, quote the words that
show it, and say what would most likely have produced a number instead.

Then give one recommendation in Hebrew covering the pattern across all of them.
Be specific and concrete - what to change in the email, in the RFQ, or in the
process. No generic advice about "building relationships". If the evidence
points at something we are doing wrong, say so plainly. Short hyphens (-), never
long dashes.`,
    messages: [{ role: "user", content: cases.join("\n\n=====\n\n") }],
  });

  const message = await stream.finalMessage();
  const json = message.content.find((b) => b.type === "text")?.text;
  if (!json) {
    console.log("no analysis returned");
    process.exit(1);
  }

  const parsed = Analysis.parse(JSON.parse(json));

  const counts = new Map<string, number>();
  for (const s of parsed.suppliers) counts.set(s.blocker, (counts.get(s.blocker) ?? 0) + 1);

  console.log("what stopped them:");
  for (const [blocker, n] of [...counts].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(2)}  ${blocker}`);
  }

  console.log("\nper supplier:");
  for (const s of parsed.suppliers) {
    console.log(`\n  ${s.company}  [${s.blocker}]`);
    console.log(`    said: ${s.evidence.slice(0, 160)}`);
    console.log(`    fix:  ${s.what_would_have_worked}`);
  }

  console.log(`\n=== recommendation ===\n${parsed.recommendation_he}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
