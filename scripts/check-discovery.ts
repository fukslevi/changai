/**
 * Why a project is short of its outreach target.
 *
 * The number the operator sees is "5 suppliers contacted", and every step
 * between a search result and that number can be the one losing the other 25:
 * the search not running again, a lead with no address, a score under the
 * approval threshold, or an approved lead that has simply not been sent yet.
 * Printing the whole funnel says which.
 */
import { asc, eq } from "drizzle-orm";
import { db, outreach, projects, supplierLeads } from "../lib/db";
import { MAX_DISCOVERY_RUNS, TARGET_LEADS } from "../lib/discovery/run";

async function main() {
  for (const project of await db.select().from(projects).orderBy(asc(projects.createdAt))) {
    const leads = await db
      .select()
      .from(supplierLeads)
      .where(eq(supplierLeads.projectId, project.id));

    const sent = await db.select().from(outreach).where(eq(outreach.projectId, project.id));

    const withEmail = leads.filter((l) => l.email);
    const approved = leads.filter((l) => l.status === "approved");
    const pending = leads.filter((l) => l.status === "pending");
    const rejected = leads.filter((l) => l.status === "rejected");
    const approvedNoEmail = approved.filter((l) => !l.email);

    const scores = leads
      .map((l) => l.matchScore)
      .filter((s): s is number => s !== null)
      .sort((a, b) => b - a);

    console.log(`\n${project.name}`);
    console.log(`  discovery runs: ${project.discoveryRuns} of ${MAX_DISCOVERY_RUNS} allowed`);
    console.log(`  leads found:    ${leads.length} (target ${TARGET_LEADS})`);
    console.log(`    with email:   ${withEmail.length}`);
    console.log(`    approved:     ${approved.length}${approvedNoEmail.length ? ` (${approvedNoEmail.length} with no address)` : ""}`);
    console.log(`    pending:      ${pending.length}`);
    console.log(`    rejected:     ${rejected.length}`);
    console.log(`  outreach rows:  ${sent.length}`);
    console.log(`  scores:         ${scores.join(" ")}`);

    const belowThreshold = pending.filter((l) => (l.matchScore ?? 0) < 30);
    if (belowThreshold.length > 0) {
      console.log(`  ${belowThreshold.length} pending below the 30 auto-approve threshold:`);
      for (const lead of belowThreshold) {
        console.log(`    ${lead.matchScore} ${lead.companyName}${lead.email ? "" : " (no email)"}`);
      }
    }

    const pendingWithEmail = pending.filter((l) => l.email && (l.matchScore ?? 0) >= 30);
    if (pendingWithEmail.length > 0) {
      console.log(`  ${pendingWithEmail.length} pending, scored and addressed - should have been approved`);
    }
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
