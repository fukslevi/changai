/**
 * Resolve interrupted sends against the mailbox.
 *
 *   npx tsx --env-file=.env scripts/reconcile.ts [projectId]
 */
import { db, projects } from "../lib/db";
import { reconcileQueued } from "../lib/outreach/batch";

async function main() {
  const wanted = process.argv[2];
  const all = await db.select().from(projects);
  const project = wanted ? all.find((p) => p.id === wanted) : all[0];
  if (!project) {
    console.error("No project found.");
    process.exit(1);
  }

  const results = await reconcileQueued(project.id);
  if (results.length === 0) console.log("Nothing was left queued.");

  for (const r of results) {
    console.log(
      r.outcome === "was-sent"
        ? `${r.company}: the message did go out - recorded as sent`
        : `${r.company}: never sent - returned to the pending list`,
    );
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
