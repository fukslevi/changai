/**
 * Apply the current approval threshold to leads that were approved under an
 * older, lower one and have not been written to yet.
 *
 *   npx tsx --env-file=.env scripts/unapprove-below-threshold.ts [--apply]
 *
 * Raising AUTO_APPROVE_SCORE governs future approvals only: campaignStatus
 * builds its queue from status = "approved" and never re-checks the score, so
 * a lead approved at 32 stays in the queue no matter where the bar moves. That
 * is right for anyone already contacted - the mail has gone - and wrong for a
 * project that has not started, which is the case the threshold exists for.
 *
 * A lead that has been written to is already "contacted", not "approved", so
 * the queue this touches is by definition nobody who has heard from us.
 *
 * Leads go back to "pending", not "rejected": they stay visible on the project
 * page and can be approved by hand, and nothing is destroyed. Anyone already
 * contacted is left alone.
 */
import { and, asc, eq, isNull } from "drizzle-orm";
import { db, projects, supplierLeads } from "../lib/db";
import { AUTO_APPROVE_SCORE } from "../lib/discovery/run";

async function main() {
  const apply = process.argv.includes("--apply");
  let total = 0;

  const live = await db
    .select()
    .from(projects)
    .where(isNull(projects.archivedAt))
    .orderBy(asc(projects.createdAt));

  for (const project of live) {
    const approved = await db
      .select()
      .from(supplierLeads)
      .where(
        and(eq(supplierLeads.projectId, project.id), eq(supplierLeads.status, "approved")),
      );

    /*
     * "approved" already means nobody has written to them: sending flips the
     * lead to "contacted". There is no separate sent-at column to check, and
     * checking one that does not exist reads as false in JavaScript and lets
     * everything through - which is the wrong direction to be wrong in.
     */
    const low = approved.filter((lead) => (lead.matchScore ?? 0) < AUTO_APPROVE_SCORE);
    if (low.length === 0) {
      console.log(`${project.name}: nothing to do`);
      continue;
    }

    total += low.length;
    console.log(`\n${project.name}: ${low.length} unsent leads below ${AUTO_APPROVE_SCORE}`);
    for (const lead of low) {
      console.log(`  ${String(lead.matchScore).padStart(3)}  ${lead.companyName}`);
      if (apply) {
        await db
          .update(supplierLeads)
          .set({ status: "pending", decidedAt: null, decidedBy: null })
          .where(eq(supplierLeads.id, lead.id));
      }
    }
  }

  console.log(
    `\n${total} leads ${apply ? "returned to pending" : "would be returned to pending - rerun with --apply"}`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
