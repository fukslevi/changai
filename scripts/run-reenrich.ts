/** Another attempt at an address for every lead that has none. */
import { db, projects } from "../lib/db";
import { reenrichMissing } from "../lib/discovery/run";

async function main() {
  for (const project of await db.select().from(projects)) {
    if (project.pausedAt) {
      console.log(`${project.name}: switched off, skipped`);
      continue;
    }
    const result = await reenrichMissing(project.id, { limit: 15 });
    console.log(`${project.name}: retried ${result.tried}, found ${result.found} new addresses`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
