/** One line per project: on or off, what it is doing, when it last ran. */
import { asc } from "drizzle-orm";
import { db, projects } from "../lib/db";
import { ACTIVITY_LABEL, projectStatuses } from "../lib/project-status";

async function main() {
  const rows = await db.select().from(projects).orderBy(asc(projects.createdAt));
  const statuses = await projectStatuses(rows);

  for (const project of rows) {
    const status = statuses.get(project.id);
    const switchState = project.pausedAt
      ? `OFF since ${project.pausedAt.toISOString()}`
      : "on";
    console.log(`${project.name}`);
    console.log(`  switch: ${switchState}`);
    console.log(`  status: ${ACTIVITY_LABEL[status?.activity ?? "draft"]} · ${status?.nextAction}`);
    console.log(`  last cycled: ${project.lastCycledAt?.toISOString() ?? "never"}`);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
