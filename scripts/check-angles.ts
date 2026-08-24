/** The search angles generated for each project, and why. */
import { asc } from "drizzle-orm";
import { db, projects } from "../lib/db";

async function main() {
  for (const project of await db.select().from(projects).orderBy(asc(projects.createdAt))) {
    console.log(`\n${project.name} (round ${project.discoveryRuns})`);
    if (!project.searchAngles || project.searchAngles.length === 0) {
      console.log("  none generated yet");
      continue;
    }
    project.searchAngles.forEach((angle, i) => {
      console.log(`  ${i + 1}. ${angle.query}`);
      console.log(`     ${angle.reason}`);
    });
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
