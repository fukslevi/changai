/**
 * How many leads will actually become an outreach.
 *
 * The number that matters, and the one no single column holds: a lead needs an
 * address and a score above the approval bar, and the ones already written to
 * count even though their status has moved on.
 */
import { asc, eq } from "drizzle-orm";
import { db, projects, supplierLeads } from "../lib/db";
import { AUTO_APPROVE_SCORE, MAX_DISCOVERY_RUNS, TARGET_LEADS } from "../lib/discovery/run";

async function main() {
  for (const project of await db.select().from(projects).orderBy(asc(projects.createdAt))) {
    const leads = await db
      .select()
      .from(supplierLeads)
      .where(eq(supplierLeads.projectId, project.id));

    const contacted = leads.filter((l) => l.status === "contacted");
    const usable = leads.filter(
      (l) =>
        (l.email !== null || l.status === "contacted") &&
        (l.matchScore ?? 0) >= AUTO_APPROVE_SCORE &&
        l.status !== "rejected",
    );
    const queued = usable.filter((l) => l.status !== "contacted");
    const noEmail = leads.filter((l) => !l.email && l.status !== "contacted");
    const lowScore = leads.filter(
      (l) => l.email && (l.matchScore ?? 0) < AUTO_APPROVE_SCORE && l.status !== "contacted",
    );

    console.log(`\n${project.name}${project.pausedAt ? "  [OFF]" : ""}`);
    console.log(`  contacted:      ${contacted.length} of ${TARGET_LEADS}`);
    console.log(`  queued to send: ${queued.length}`);
    console.log(`  usable total:   ${usable.length}`);
    console.log(`  held back:      ${noEmail.length} with no address, ${lowScore.length} scored under ${AUTO_APPROVE_SCORE}`);
    console.log(`  search rounds:  ${project.discoveryRuns} of ${MAX_DISCOVERY_RUNS}`);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
