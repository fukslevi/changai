/**
 * List stored leads for a project.
 *
 *   npx tsx --env-file=.env scripts/leads.ts [projectId]
 */
import { desc, eq } from "drizzle-orm";
import { db, projects, supplierLeads } from "../lib/db";

async function main() {
  const wanted = process.argv[2];
  const all = await db.select().from(projects);
  const project = wanted ? all.find((p) => p.id === wanted) : all[0];
  if (!project) {
    console.error("No project found.");
    process.exit(1);
  }

  const leads = await db
    .select()
    .from(supplierLeads)
    .where(eq(supplierLeads.projectId, project.id))
    .orderBy(desc(supplierLeads.matchScore));

  const withEmail = leads.filter((l) => l.email);
  const byStatus = (s: string) => leads.filter((l) => l.status === s).length;

  console.log(
    `${project.name}: ${leads.length} leads · ${withEmail.length} with email · ` +
      `${byStatus("pending")} pending · ${byStatus("approved")} approved · ` +
      `${byStatus("rejected")} rejected · ${byStatus("contacted")} contacted\n`,
  );

  const MARK = { approved: "OK ", rejected: "NO ", contacted: "SENT", pending: "   " };

  for (const lead of leads) {
    const score = lead.matchScore === null ? " ??" : String(lead.matchScore).padStart(3);
    const mark = MARK[lead.status].padEnd(4);
    console.log(`${mark}${score}  ${lead.companyName.padEnd(44).slice(0, 44)} ${lead.email ?? "-"}`);
  }

  const flagged = leads.filter((l) => /goldsupplier|alibaba|made-in-china/i.test(l.website ?? ""));
  if (flagged.length > 0) {
    console.log(`\nMarketplace pages that slipped the filter (${flagged.length}):`);
    for (const f of flagged) console.log(`  ${f.website}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
