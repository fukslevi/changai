/**
 * Run supplier discovery headlessly and print the shortlist.
 *
 *   npx tsx --env-file=.env scripts/discover.ts [projectId]
 *
 * Contacts nobody. Every lead lands as pending for approval in the app.
 */
import { desc, eq } from "drizzle-orm";
import { db, projects, supplierLeads } from "../lib/db";
import { runDiscovery } from "../lib/discovery/run";

async function main() {
  const wanted = process.argv[2];
  const all = await db.select().from(projects);
  const project = wanted ? all.find((p) => p.id === wanted) : all[0];
  if (!project) {
    console.error("No project found.");
    process.exit(1);
  }

  console.log(`Project  : ${project.name}`);
  console.log(`Keywords : ${project.keywords.join(" | ")}\n`);

  console.time("discovery");
  const result = await runDiscovery(project.id);
  console.timeEnd("discovery");

  console.log(
    `\ndomains found ${result.searched} · sites reachable ${result.enriched} · with email ${result.withEmail} · saved ${result.saved}\n`,
  );

  const leads = await db
    .select()
    .from(supplierLeads)
    .where(eq(supplierLeads.projectId, project.id))
    .orderBy(desc(supplierLeads.matchScore));

  for (const lead of leads) {
    const score = lead.matchScore === null ? " ??" : String(lead.matchScore).padStart(3);
    console.log(`${score}  ${lead.companyName}`);
    console.log(`      ${lead.website}  ${lead.email ?? "(no email found)"}`);
    if (lead.matchRationale) console.log(`      ${lead.matchRationale}`);
    console.log();
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(`\n${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
});
