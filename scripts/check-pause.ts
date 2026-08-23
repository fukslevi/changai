/**
 * Prove the off switch is real: pause a project, read its status, put it back.
 *
 * Restores in a finally block. A check that can leave a live project switched
 * off is worse than no check.
 */
import { eq } from "drizzle-orm";
import { db, projects } from "../lib/db";
import { dispatchNotifications } from "../lib/notify/dispatch";
import { projectStatuses } from "../lib/project-status";

async function main() {
  const all = await db.select().from(projects);
  const target = all.find((p) => !p.pausedAt);
  if (!target) {
    console.log("no live project to test with");
    process.exit(0);
  }

  const before = (await projectStatuses([target])).get(target.id);
  console.log(`before: ${target.name} -> ${before?.activity} · ${before?.nextAction}`);

  try {
    await db.update(projects).set({ pausedAt: new Date() }).where(eq(projects.id, target.id));

    const paused = (await db.select().from(projects).where(eq(projects.id, target.id)))[0]!;
    const after = (await projectStatuses([paused])).get(target.id);
    console.log(`paused: ${paused.name} -> ${after?.activity} · ${after?.nextAction}`);

    const announcements = await dispatchNotifications({ send: false });
    const leaked = announcements.filter((a) => a.project === target.name);
    console.log(
      leaked.length === 0
        ? "paused project announced nothing"
        : `LEAK: paused project would still send ${leaked.length}`,
    );
  } finally {
    await db.update(projects).set({ pausedAt: null }).where(eq(projects.id, target.id));
    const restored = (await db.select().from(projects).where(eq(projects.id, target.id)))[0]!;
    console.log(`restored: pausedAt = ${restored.pausedAt}`);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
