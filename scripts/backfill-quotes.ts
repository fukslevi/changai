/**
 * Re-read the replies whose extraction failed.
 *
 * Adding one nullable field to the extraction schema pushed it past the API's
 * limit of sixteen union-typed parameters, so every extraction after that point
 * threw - into an errors array nobody reads. Replies containing prices produced
 * no quotes, and the comparison stayed empty while the mailbox filled up.
 *
 * Only messages with no reading are re-read, so this is safe to run twice.
 */
import { and, asc, eq } from "drizzle-orm";
import { db, items, messages, projects, quoteReadings, requirements, suppliers } from "../lib/db";
import { attachmentBlocks } from "../lib/quotes/context";
import { extractQuote } from "../lib/quotes/extract";

async function main() {
  for (const project of await db.select().from(projects).orderBy(asc(projects.createdAt))) {
    if (project.archivedAt) continue;

    const readings = await db
      .select()
      .from(quoteReadings)
      .where(eq(quoteReadings.projectId, project.id));
    const done = new Set(readings.map((r) => r.messageId));

    const inbound = await db
      .select({
        id: messages.id,
        supplierId: messages.supplierId,
        company: suppliers.companyName,
        from: messages.fromAddress,
        subject: messages.subject,
        body: messages.bodyText,
        att: messages.attachments,
        cls: messages.classification,
      })
      .from(messages)
      .leftJoin(suppliers, eq(messages.supplierId, suppliers.id))
      .where(and(eq(messages.projectId, project.id), eq(messages.direction, "inbound")))
      .orderBy(asc(messages.receivedAt));

    const todo = inbound.filter((m) => !done.has(m.id) && m.cls !== "not_relevant" && m.supplierId);
    if (todo.length === 0) continue;

    const reqs = (
      await db
        .select({ text: requirements.text })
        .from(requirements)
        .where(eq(requirements.projectId, project.id))
    ).map((r) => r.text);

    const names = (await db.select().from(items).where(eq(items.projectId, project.id)))
      .filter((i) => i.kind === "priced_variant")
      .map((i) => i.name);

    console.log(`\n=== ${project.name}: re-reading ${todo.length} replies ===`);

    for (const m of todo) {
      try {
        const blocks = await attachmentBlocks(m.att ?? []);
        const { quote } = await extractQuote(
          project.name,
          reqs,
          { fromAddress: m.from ?? "", subject: m.subject ?? "", bodyText: m.body ?? "" },
          blocks as never,
          names,
        );

        if (!quote.has_pricing && !quote.rejects_target_price && quote.deviations.length === 0) {
          console.log(`  ${m.company}: nothing to record`);
          continue;
        }

        await db.insert(quoteReadings).values({
          projectId: project.id,
          supplierId: m.supplierId as string,
          messageId: m.id,
          currency: quote.currency,
          incoterm: quote.incoterm,
          incotermPlace: quote.incoterm_place,
          lines: quote.lines,
          moq: quote.moq,
          leadTimeDays: quote.lead_time_days,
          paymentTerms: quote.payment_terms,
          samplePrice: quote.sample_price === null ? null : String(quote.sample_price),
          sampleLeadTimeDays: quote.sample_lead_time_days,
          toolingCost: quote.tooling_cost === null ? null : String(quote.tooling_cost),
          certificates: quote.certificates,
          unitsPerCarton: quote.units_per_carton,
          cartonDimensionsCm: quote.carton_dimensions_cm,
          cartonGrossWeightKg:
            quote.carton_gross_weight_kg === null ? null : String(quote.carton_gross_weight_kg),
          deviations: quote.deviations,
          rejectsTargetPrice: quote.rejects_target_price,
          priceObjection: quote.price_objection,
          summaryHe: quote.summary_he,
        });

        const priced = quote.lines.filter((l) => l.unit_price !== null).length;
        console.log(
          `  ${m.company}: ${priced} priced lines${quote.rejects_target_price ? " · refused the target" : ""}`,
        );
      } catch (err) {
        console.log(`  ${m.company}: FAILED ${String(err).slice(0, 120)}`);
      }
    }
  }

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
