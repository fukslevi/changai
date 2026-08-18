/**
 * Show the suggested reply for one supplier without sending anything.
 *
 *   npx tsx --env-file=.env scripts/draft-test.ts "Suzhou"
 */
import { db, projects, suppliers } from "../lib/db";
import { conversations } from "../lib/inbox/run";
import { draftReply } from "../lib/inbox/reply";

async function main() {
  const needle = (process.argv[2] ?? "").toLowerCase();
  const all = await db.select().from(projects);
  const project = all[0];
  if (!project) { console.error("No project"); process.exit(1); }

  const rows = await conversations(project.id);
  const match = rows.find(
    (r) => r.direction === "inbound" && (r.company ?? "").toLowerCase().includes(needle),
  );
  if (!match?.supplierId) { console.error(`No inbound message matching "${needle}"`); process.exit(1); }

  console.log(`--- suggested reply to ${match.company} ---\n`);
  console.log(await draftReply({ projectId: project.id, supplierId: match.supplierId }));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
