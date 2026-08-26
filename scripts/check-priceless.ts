/**
 * Suppliers who answered and never gave a number.
 *
 * These are the conversations the new instruction is for. They already wrote
 * back - so they are reachable, interested enough to reply, and know the
 * product - and the exchange produced no price, which makes them worth less to
 * the comparison than a factory that never answered at all is worth to nothing.
 */
import { and, asc, eq } from "drizzle-orm";
import { db, messages, projects, quoteReadings, supplierLeads, suppliers } from "../lib/db";

async function main() {
  for (const project of await db.select().from(projects).orderBy(asc(projects.createdAt))) {
    if (project.archivedAt) continue;

    const inbound = await db
      .select({
        supplierId: messages.supplierId,
        company: suppliers.companyName,
        receivedAt: messages.receivedAt,
      })
      .from(messages)
      .leftJoin(suppliers, eq(messages.supplierId, suppliers.id))
      .where(
        and(eq(messages.projectId, project.id), eq(messages.direction, "inbound")),
      );

    const repliers = new Map<string, { company: string; last: Date }>();
    for (const row of inbound) {
      if (!row.supplierId) continue;
      const held = repliers.get(row.supplierId);
      if (!held || row.receivedAt > held.last) {
        repliers.set(row.supplierId, {
          company: row.company ?? "ספק",
          last: row.receivedAt,
        });
      }
    }

    const readings = await db
      .select()
      .from(quoteReadings)
      .where(eq(quoteReadings.projectId, project.id));

    const priced = new Set(
      readings
        .filter((r) => r.lines.some((l) => l.unit_price !== null))
        .map((r) => r.supplierId),
    );

    const refused = new Set(readings.filter((r) => r.rejectsTargetPrice).map((r) => r.supplierId));

    const takenOver = new Set(
      (
        await db
          .select({ supplierId: supplierLeads.supplierId })
          .from(supplierLeads)
          .where(eq(supplierLeads.projectId, project.id))
      )
        .filter((l) => l.supplierId)
        .map((l) => l.supplierId),
    );
    void takenOver;

    const priceless = [...repliers].filter(([id]) => !priced.has(id));

    console.log(`\n${project.name}`);
    console.log(`  ${repliers.size} replied · ${priced.size} gave a price · ${priceless.length} did not`);

    for (const [id, info] of priceless) {
      console.log(
        `    ${info.company}${refused.has(id) ? "  [said the target is impossible]" : ""}`,
      );
    }
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
