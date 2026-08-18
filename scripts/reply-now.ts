/**
 * Draft and send one reply, showing exactly what went out.
 *
 *   npx tsx --env-file=.env scripts/reply-now.ts "hangzhou"
 */
import { db, projects } from "../lib/db";
import { conversations } from "../lib/inbox/run";
import { draftReply, sendReply } from "../lib/inbox/reply";

async function main() {
  const needle = (process.argv[2] ?? "").toLowerCase();
  const [project] = await db.select().from(projects);
  if (!project) process.exit(1);

  const rows = await conversations(project.id);
  const match = rows.find(
    (r) => r.direction === "inbound" && (r.company ?? "").toLowerCase().includes(needle),
  );
  if (!match?.supplierId) { console.error(`no thread matching "${needle}"`); process.exit(1); }

  const body = await draftReply({ projectId: project.id, supplierId: match.supplierId });
  console.log(`--- sending to ${match.company} ---\n`);
  console.log(body);

  const result = await sendReply(project.id, match.supplierId, body);
  console.log(`\nSent. messageId=${result.messageId} threadId=${result.threadId}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
