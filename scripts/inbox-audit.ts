/**
 * Every inbound message in the mailbox versus what we have recorded.
 *
 *   npx tsx --env-file=.env scripts/inbox-audit.ts
 *
 * The poll only walks threads we started. Anything a supplier sends on a new
 * thread - a different subject line, a forward, a colleague replying fresh - is
 * invisible to it, and invisible is indistinguishable from "no reply".
 */
import { eq } from "drizzle-orm";
import { db, messages, projects, suppliers } from "../lib/db";
import { gmailClient } from "../lib/mail/gmail";
import { getSettings } from "../lib/settings";

async function main() {
  const [project] = await db.select().from(projects);
  if (!project) process.exit(1);
  const settings = await getSettings();

  const known = new Set(
    (await db.select({ id: messages.gmailMessageId }).from(messages).where(eq(messages.projectId, project.id)))
      .map((m) => m.id),
  );
  const supplierRows = await db.select().from(suppliers);
  const byEmail = new Map(supplierRows.filter((s) => s.email).map((s) => [s.email as string, s.companyName]));

  const gmail = gmailClient();
  const list = await gmail.users.messages.list({
    userId: "me",
    q: `in:inbox -from:${settings.sourcingMailbox} newer_than:14d`,
    maxResults: 60,
  });

  console.log(`${list.data.messages?.length ?? 0} inbound messages in the last 14 days\n`);
  let missing = 0;

  for (const item of list.data.messages ?? []) {
    const m = await gmail.users.messages.get({
      userId: "me", id: item.id as string, format: "metadata",
      metadataHeaders: ["From", "Subject", "Date"],
    });
    const h = Object.fromEntries((m.data.payload?.headers ?? []).map((x) => [x.name, x.value]));
    const from = (h.From ?? "").toLowerCase();
    const addr = from.match(/<([^>]+)>/)?.[1] ?? from;
    const supplier = byEmail.get(addr);
    const recorded = known.has(m.data.id as string);

    if (!recorded) {
      missing++;
      console.log(`MISSING  ${addr}`);
      console.log(`         supplier in db: ${supplier ?? "NOT A KNOWN SUPPLIER"}`);
      console.log(`         subject: ${h.Subject}`);
      console.log(`         thread : ${m.data.threadId}\n`);
    }
  }
  console.log(`${missing} messages are in the mailbox but not recorded.`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
