/** The funnel, per project. */
import { asc } from "drizzle-orm";
import { db, projects } from "../lib/db";
import { projectStats } from "../lib/project-stats";

async function main() {
  const rows = await db.select().from(projects).orderBy(asc(projects.createdAt));
  const stats = await projectStats(rows.map((r) => r.id));

  for (const project of rows) {
    const s = stats.get(project.id);
    if (!s) continue;

    console.log(`\n${project.name}${project.archivedAt ? "  [archived]" : ""}`);
    console.log(
      `  ${s.contacted} contacted → ${s.replied} replied (${s.replyRatePct ?? "-"}%) → ${s.quoted} quoted (${s.quoteRatePct ?? "-"}% of repliers) → ${s.inRange} in range`,
    );
    console.log(
      `  best: ${s.bestGapPct === null ? "no prices yet" : `${s.bestSupplier} at ${s.bestGapPct >= 0 ? "+" : ""}${s.bestGapPct.toFixed(0)}%`}`,
    );
    console.log(`  refused the target: ${s.refused}`);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
