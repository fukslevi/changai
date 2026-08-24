/**
 * Are we bouncing, and would we know?
 *
 * Nothing in the app looks for a bounce. `outreach.failed` means our own send
 * threw, or a supplier went quiet through two follow-ups - neither is a dead
 * address. A hard bounce arrives hours later as a message from a mail daemon,
 * on a thread we started, and as far as the poller is concerned that is just
 * another reply.
 *
 * That matters more than the daily total: a mailbox writing to addresses that
 * do not exist loses its reputation long before it reaches any published quota.
 */
import { asc, eq } from "drizzle-orm";
import { db, messages, projects } from "../lib/db";

const BOUNCE_SENDERS = /mailer-daemon|postmaster|no-?reply|delivery|mail delivery/i;
const BOUNCE_SUBJECTS =
  /undeliverable|delivery (status|has failed|failure|incomplete)|returned mail|failure notice|address not found|rejected/i;

async function main() {
  const inbound = await db
    .select({
      project: projects.name,
      from: messages.fromAddress,
      subject: messages.subject,
      classification: messages.classification,
      body: messages.bodyText,
      at: messages.receivedAt,
    })
    .from(messages)
    .leftJoin(projects, eq(messages.projectId, projects.id))
    .where(eq(messages.direction, "inbound"))
    .orderBy(asc(messages.receivedAt));

  const suspected = inbound.filter(
    (m) =>
      BOUNCE_SENDERS.test(m.from ?? "") ||
      BOUNCE_SUBJECTS.test(m.subject ?? "") ||
      /550|551|553|554|5\.1\.1|recipient address rejected|user unknown/i.test(m.body ?? ""),
  );

  console.log(`${inbound.length} inbound messages, ${suspected.length} look like bounces\n`);
  for (const row of suspected) {
    console.log(`${row.at.toISOString()}  ${row.project}`);
    console.log(`  from:    ${row.from}`);
    console.log(`  subject: ${row.subject}`);
    console.log(`  classed: ${row.classification}`);
  }

  console.log("\n=== every inbound sender, to eyeball what the poller is picking up ===");
  const senders = new Map<string, number>();
  for (const row of inbound) {
    const address = (row.from ?? "").match(/<([^>]+)>/)?.[1] ?? row.from ?? "?";
    senders.set(address, (senders.get(address) ?? 0) + 1);
  }
  for (const [address, n] of [...senders].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${n}x ${address}`);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
