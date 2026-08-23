/**
 * Every chase we have sent, and what the follow-up logic thinks it has sent.
 *
 * The two disagreed once - the marker the count read was never written - and a
 * limit that reads a field nothing writes looks exactly like a limit that
 * works, right up until a supplier gets the same email for the ninth time.
 */
import { asc, eq } from "drizzle-orm";
import { db, messages, projects, suppliers } from "../lib/db";
import { silentThreads } from "../lib/inbox/followup";

async function main() {
  const rows = await db
    .select({
      project: projects.name,
      projectId: messages.projectId,
      company: suppliers.companyName,
      kind: messages.outboundKind,
      sentAt: messages.receivedAt,
    })
    .from(messages)
    .leftJoin(suppliers, eq(messages.supplierId, suppliers.id))
    .leftJoin(projects, eq(messages.projectId, projects.id))
    .where(eq(messages.direction, "outbound"))
    .orderBy(asc(messages.receivedAt));

  const chases = rows.filter((row) => row.kind === "chase");
  console.log(`${chases.length} chases among ${rows.length} outbound messages\n`);

  for (const row of chases) {
    console.log(`${row.sentAt.toISOString()}  ${row.project} · ${row.company}`);
  }

  console.log("\nwhat the follow-up logic counts:");
  for (const project of await db.select().from(projects)) {
    const threads = await silentThreads(project.id);
    const active = threads.filter((t) => t.chasesSent > 0 || t.due || t.exhausted);
    if (active.length === 0) continue;
    console.log(`\n${project.name}`);
    for (const thread of active) {
      console.log(
        `  ${thread.company}: ${thread.chasesSent} sent, ${thread.daysSilent}d silent` +
          `${thread.due ? ", due now" : ""}${thread.exhausted ? ", exhausted" : ""}`,
      );
    }
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
