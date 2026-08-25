/** Do we hold this supplier's message at all, and what happened to it? */
import { asc, eq, ilike, or } from "drizzle-orm";
import { db, messages, outreach, projects, supplierLeads, suppliers } from "../lib/db";

async function main() {
  const needle = process.argv[2] ?? "sure-all";

  console.log(`=== suppliers matching "${needle}" ===`);
  const matched = await db
    .select()
    .from(suppliers)
    .where(or(ilike(suppliers.email, `%${needle}%`), ilike(suppliers.website, `%${needle}%`), ilike(suppliers.companyName, `%${needle}%`)));

  for (const supplier of matched) {
    console.log(`  ${supplier.companyName}`);
    console.log(`    email:   ${supplier.email}`);
    console.log(`    website: ${supplier.website}`);
    console.log(`    id:      ${supplier.id}`);
  }
  if (matched.length === 0) console.log("  none");

  console.log(`\n=== leads matching "${needle}" ===`);
  const leads = await db
    .select()
    .from(supplierLeads)
    .where(or(ilike(supplierLeads.email, `%${needle}%`), ilike(supplierLeads.domain, `%${needle}%`), ilike(supplierLeads.companyName, `%${needle}%`)));
  for (const lead of leads) {
    console.log(`  ${lead.companyName} · domain ${lead.domain} · email ${lead.email} · ${lead.status}`);
  }
  if (leads.length === 0) console.log("  none");

  console.log(`\n=== messages from/to "${needle}" ===`);
  const rows = await db
    .select({
      project: projects.name,
      direction: messages.direction,
      from: messages.fromAddress,
      subject: messages.subject,
      classification: messages.classification,
      handledAt: messages.handledAt,
      analysis: messages.analysis,
      receivedAt: messages.receivedAt,
    })
    .from(messages)
    .leftJoin(projects, eq(messages.projectId, projects.id))
    .where(ilike(messages.fromAddress, `%${needle}%`))
    .orderBy(asc(messages.receivedAt));

  for (const row of rows) {
    console.log(`  ${row.receivedAt.toISOString()} [${row.direction}] ${row.project}`);
    console.log(`    from:    ${row.from}`);
    console.log(`    subject: ${row.subject}`);
    console.log(`    class:   ${row.classification} · handled: ${row.handledAt?.toISOString() ?? "NO"}`);
    const analysis = row.analysis as { needs_human?: boolean; needs_human_reason?: string } | null;
    if (analysis?.needs_human) console.log(`    needs human: ${analysis.needs_human_reason}`);
  }
  if (rows.length === 0) console.log("  none - the poller never stored anything from this address");

  console.log(`\n=== outreach rows for matched suppliers ===`);
  for (const supplier of matched) {
    const sent = await db.select().from(outreach).where(eq(outreach.supplierId, supplier.id));
    for (const row of sent) {
      console.log(`  ${supplier.companyName}: ${row.status} · thread ${row.gmailThreadId} · ${row.subject}`);
    }
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
