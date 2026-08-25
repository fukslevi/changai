/**
 * Messages the agent parked instead of answering, and whether it needed to.
 *
 * Parking marks the message handled, which is what makes this worth a script:
 * a parked thread looks answered from every count on the page. The supplier is
 * waiting, the queue says zero, and nothing is obviously wrong.
 */
import { asc, eq } from "drizzle-orm";
import { db, messages, openQuestions, projects, requirements, suppliers } from "../lib/db";

async function main() {
  const name = process.argv[2] ?? "LED";
  const all = await db.select().from(projects);
  const project = all.find((p) => p.name.toLowerCase().includes(name.toLowerCase()));
  if (!project) {
    console.log(`no project matching "${name}"`);
    process.exit(1);
  }

  console.log(`${project.name} · autonomyTier ${project.autonomyTier}\n`);

  const inbound = await db
    .select({
      company: suppliers.companyName,
      from: messages.fromAddress,
      subject: messages.subject,
      classification: messages.classification,
      handledAt: messages.handledAt,
      analysis: messages.analysis,
      receivedAt: messages.receivedAt,
    })
    .from(messages)
    .leftJoin(suppliers, eq(messages.supplierId, suppliers.id))
    .where(eq(messages.projectId, project.id))
    .orderBy(asc(messages.receivedAt));

  const parked = inbound.filter((m) => {
    const analysis = m.analysis as { needs_human?: boolean } | null;
    return analysis?.needs_human === true;
  });

  console.log(`${parked.length} of ${inbound.length} inbound messages were parked for a human:`);
  for (const row of parked) {
    const analysis = row.analysis as {
      needs_human_reason?: string;
      questions_from_supplier?: string[];
    } | null;
    console.log(`\n  ${row.company ?? row.from}  (${row.receivedAt.toISOString().slice(0, 16)}Z)`);
    console.log(`    handled: ${row.handledAt ? "yes - invisible in the queue" : "no"}`);
    console.log(`    reason:  ${analysis?.needs_human_reason}`);
    for (const q of analysis?.questions_from_supplier ?? []) {
      console.log(`    asked:   ${q}`);
    }
  }

  const open = await db
    .select()
    .from(openQuestions)
    .where(eq(openQuestions.projectId, project.id));

  console.log(`\n=== open questions raised for you: ${open.length} ===`);
  for (const q of open) {
    console.log(`  [${q.status}] ${q.questionHe}`);
  }

  const reqs = await db
    .select({ text: requirements.text })
    .from(requirements)
    .where(eq(requirements.projectId, project.id));

  console.log(`\n=== does the RFQ answer it? requirements mentioning certification ===`);
  const relevant = reqs.filter((r) => /UL|SGS|CE|RoHS|certif|explosion|IP\d/i.test(r.text));
  for (const r of relevant) console.log(`  ${r.text}`);
  if (relevant.length === 0) console.log("  nothing in the RFQ about certification");

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
