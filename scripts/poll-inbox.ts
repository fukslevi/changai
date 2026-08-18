/**
 * Pull supplier replies and triage them.
 *
 *   npx tsx --env-file=.env scripts/poll-inbox.ts [projectId]
 */
import { db, projects } from "../lib/db";
import { pollInbox } from "../lib/inbox/run";

async function main() {
  const wanted = process.argv[2];
  const all = await db.select().from(projects);
  const project = wanted ? all.find((p) => p.id === wanted) : all[0];
  if (!project) {
    console.error("No project found.");
    process.exit(1);
  }

  console.log(`Polling ${project.name}...\n`);
  const result = await pollInbox(project.id);

  console.log(`threads checked : ${result.threadsChecked}`);
  console.log(`new messages    : ${result.newMessages}`);
  console.log(`classified      : ${result.classified}`);
  console.log(`needs a human   : ${result.needsHuman}`);
  for (const e of result.errors) console.log(`  ! ${e}`);

  process.exit(0);
}

main().catch((err) => {
  console.error(`\n${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
});
