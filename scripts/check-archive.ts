/**
 * Prove the archive rules, then put everything back.
 *
 * Three claims worth testing, because all three are about what does not
 * happen: archiving a running project switches it off, archiving an already
 * off project leaves it off rather than toggling it, and restoring does not
 * quietly switch anything on.
 *
 * Restores in a finally block. A check that can leave a live project archived
 * is worse than no check.
 */
import { eq } from "drizzle-orm";
import { db, projects } from "../lib/db";
import { setArchived, setPaused } from "../lib/projects/switches";
import { dispatchNotifications } from "../lib/notify/dispatch";
import { projectStatuses } from "../lib/project-status";

async function read(id: string) {
  const [row] = await db.select().from(projects).where(eq(projects.id, id));
  return row!;
}

async function state(id: string) {
  const project = await read(id);
  const status = (await projectStatuses([project])).get(id);
  return `paused=${Boolean(project.pausedAt)} archived=${Boolean(project.archivedAt)} status=${status?.activity}`;
}

async function main() {
  const all = await db.select().from(projects);
  const running = all.find((p) => !p.pausedAt && !p.archivedAt);
  const alreadyOff = all.find((p) => p.pausedAt && !p.archivedAt);

  if (!running) {
    console.log("no running project to test with");
    process.exit(0);
  }

  const originals = new Map(
    all.map((p) => [p.id, { pausedAt: p.pausedAt, archivedAt: p.archivedAt }]),
  );

  try {
    console.log(`running project: ${running.name}`);
    console.log(`  before:   ${await state(running.id)}`);

    await setArchived(running.id, true);
    console.log(`  archived: ${await state(running.id)}   <- must be paused=true`);

    // Nothing archived may reach the mailbox.
    const announcements = await dispatchNotifications({ send: false });
    const leaked = announcements.filter((a) => a.project === running.name);
    console.log(
      leaked.length === 0
        ? "  archived project announced nothing"
        : `  LEAK: archived project would send ${leaked.length}`,
    );

    // The off switch must refuse to act while the project is filed away.
    const refused = await setPaused(running.id, false);
    console.log(`  switch while archived: ${refused.messageHe}`);

    await setArchived(running.id, false);
    console.log(`  restored: ${await state(running.id)}   <- must still be paused=true`);

    if (alreadyOff) {
      console.log(`\nalready-off project: ${alreadyOff.name}`);
      console.log(`  before:   ${await state(alreadyOff.id)}`);
      await setArchived(alreadyOff.id, true);
      console.log(`  archived: ${await state(alreadyOff.id)}   <- must stay paused=true`);
      await setArchived(alreadyOff.id, false);
      console.log(`  restored: ${await state(alreadyOff.id)}   <- must stay paused=true`);
    }
  } finally {
    for (const [id, original] of originals) {
      await db.update(projects).set(original).where(eq(projects.id, id));
    }
    console.log("\nrestored to how they were:");
    for (const project of await db.select().from(projects)) {
      console.log(
        `  ${project.name}: paused=${Boolean(project.pausedAt)} archived=${Boolean(project.archivedAt)}`,
      );
    }
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
