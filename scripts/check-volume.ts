/**
 * What we have actually sent, per day, and how much of it failed.
 *
 * The question "is thirty a day sustainable" cannot be answered from limits
 * documentation alone. The number that decides it is the bounce rate: addresses
 * scraped off contact pages are wrong often enough to matter, and a mailbox
 * that keeps writing to dead addresses loses its reputation long before it hits
 * any published quota.
 */
import { asc, eq } from "drizzle-orm";
import { db, messages, outreach, projects, suppliers } from "../lib/db";

function day(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function main() {
  const outbound = await db
    .select({
      project: projects.name,
      kind: messages.outboundKind,
      sentAt: messages.receivedAt,
    })
    .from(messages)
    .leftJoin(projects, eq(messages.projectId, projects.id))
    .where(eq(messages.direction, "outbound"))
    .orderBy(asc(messages.receivedAt));

  const rows = await db
    .select({
      project: projects.name,
      company: suppliers.companyName,
      status: outreach.status,
      error: outreach.error,
      sentAt: outreach.sentAt,
    })
    .from(outreach)
    .leftJoin(projects, eq(outreach.projectId, projects.id))
    .leftJoin(suppliers, eq(outreach.supplierId, suppliers.id))
    .orderBy(asc(outreach.sentAt));

  console.log("=== first contact, per day ===");
  const firstByDay = new Map<string, number>();
  for (const row of rows) {
    if (!row.sentAt) continue;
    firstByDay.set(day(row.sentAt), (firstByDay.get(day(row.sentAt)) ?? 0) + 1);
  }
  for (const [d, n] of [...firstByDay].sort()) console.log(`  ${d}  ${"#".repeat(n)} ${n}`);

  console.log("\n=== all outbound mail, per day (first contact + replies + chases) ===");
  const allByDay = new Map<string, number>();
  for (const row of outbound) {
    allByDay.set(day(row.sentAt), (allByDay.get(day(row.sentAt)) ?? 0) + 1);
  }
  for (const [d, n] of [...allByDay].sort()) console.log(`  ${d}  ${"#".repeat(n)} ${n}`);

  console.log("\n=== outreach outcomes ===");
  const byStatus = new Map<string, number>();
  for (const row of rows) byStatus.set(row.status, (byStatus.get(row.status) ?? 0) + 1);
  for (const [status, n] of [...byStatus].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${status}: ${n}`);
  }

  const failed = rows.filter((r) => r.status === "failed" && r.error);
  console.log(`\n=== ${failed.length} failures, by reason ===`);
  const byReason = new Map<string, number>();
  for (const row of failed) {
    const reason = (row.error ?? "").slice(0, 70);
    byReason.set(reason, (byReason.get(reason) ?? 0) + 1);
  }
  for (const [reason, n] of [...byReason].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${n}x ${reason}`);
  }

  const inbound = await db
    .select({ id: messages.id, supplierId: messages.supplierId })
    .from(messages)
    .where(eq(messages.direction, "inbound"));
  const repliers = new Set(inbound.map((m) => m.supplierId)).size;

  console.log(`\n=== reply rate ===`);
  console.log(`  ${rows.length} suppliers contacted`);
  console.log(`  ${repliers} replied (${((repliers / Math.max(rows.length, 1)) * 100).toFixed(0)}%)`);
  console.log(`  ${inbound.length} inbound messages in total`);
  console.log(`  ${outbound.length} outbound messages in total`);

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
