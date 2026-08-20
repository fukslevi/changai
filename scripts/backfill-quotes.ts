/**
 * Read pricing out of replies that arrived before extraction existed.
 *
 *   npx tsx --env-file=.env scripts/backfill-quotes.ts
 */
import { and, eq } from "drizzle-orm";
import { db, messages, projects, quoteReadings, requirements, suppliers } from "../lib/db";
import { attachmentBlocks } from "../lib/quotes/context";
import { extractQuote } from "../lib/quotes/extract";

async function main() {
  for (const project of await db.select().from(projects)) {
    const reqs = (
      await db.select({ text: requirements.text }).from(requirements).where(eq(requirements.projectId, project.id))
    ).map((r) => r.text);

    const inbound = await db
      .select({
        id: messages.id, supplierId: messages.supplierId, company: suppliers.companyName,
        from: messages.fromAddress, subject: messages.subject, body: messages.bodyText,
        attachments: messages.attachments, classification: messages.classification,
      })
      .from(messages)
      .leftJoin(suppliers, eq(messages.supplierId, suppliers.id))
      .where(and(eq(messages.projectId, project.id), eq(messages.direction, "inbound")));

    const done = new Set(
      (await db.select({ id: quoteReadings.messageId }).from(quoteReadings).where(eq(quoteReadings.projectId, project.id)))
        .map((r) => r.id),
    );

    console.log(`\n${project.name}: ${inbound.length} inbound`);

    for (const m of inbound) {
      if (!m.supplierId || done.has(m.id) || m.classification === "not_relevant") continue;
      try {
        const blocks = await attachmentBlocks(m.attachments);
        const { quote } = await extractQuote(
          project.name, reqs,
          { fromAddress: m.from ?? "", subject: m.subject ?? "", bodyText: m.body ?? "" },
          blocks as never,
        );
        if (!quote.has_pricing && !quote.rejects_target_price && quote.deviations.length === 0) {
          console.log(`  --  ${m.company}: no pricing`);
          continue;
        }
        await db.insert(quoteReadings).values({
          projectId: project.id, supplierId: m.supplierId, messageId: m.id,
          currency: quote.currency, incoterm: quote.incoterm, incotermPlace: quote.incoterm_place,
          lines: quote.lines, moq: quote.moq, leadTimeDays: quote.lead_time_days,
          paymentTerms: quote.payment_terms,
          samplePrice: quote.sample_price === null ? null : String(quote.sample_price),
          sampleLeadTimeDays: quote.sample_lead_time_days,
          toolingCost: quote.tooling_cost === null ? null : String(quote.tooling_cost),
          certificates: quote.certificates, unitsPerCarton: quote.units_per_carton,
          cartonDimensionsCm: quote.carton_dimensions_cm,
          cartonGrossWeightKg: quote.carton_gross_weight_kg === null ? null : String(quote.carton_gross_weight_kg),
          deviations: quote.deviations, rejectsTargetPrice: quote.rejects_target_price,
          priceObjection: quote.price_objection, summaryHe: quote.summary_he,
        });
        console.log(`  OK  ${m.company}: ${quote.lines.length} lines${quote.rejects_target_price ? " · REJECTS TARGET" : ""}${quote.deviations.length ? ` · ${quote.deviations.length} deviations` : ""}`);
      } catch (e) {
        console.log(`  !!  ${m.company}: ${e instanceof Error ? e.message : e}`);
      }
    }
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
