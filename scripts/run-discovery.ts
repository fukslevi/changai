/**
 * Run discovery for one project by name, and say what each round did.
 *
 * Storing leads only - nothing here contacts anyone, so it is safe to push
 * several rounds through by hand when a project is behind.
 */
import { asc, eq } from "drizzle-orm";
import { db, projects, supplierLeads } from "../lib/db";
import { runDiscovery, TARGET_LEADS } from "../lib/discovery/run";

async function counts(projectId: string) {
  const leads = await db
    .select()
    .from(supplierLeads)
    .where(eq(supplierLeads.projectId, projectId));
  return { total: leads.length, withEmail: leads.filter((l) => l.email).length };
}

async function main() {
  const name = process.argv[2];
  const rounds = Number(process.argv[3] ?? 2);
  if (!name) {
    console.log("usage: run-discovery <project name substring> [rounds]");
    for (const p of await db.select().from(projects).orderBy(asc(projects.createdAt))) {
      console.log(`  ${p.name} (${p.discoveryRuns} rounds used)`);
    }
    process.exit(0);
  }

  const all = await db.select().from(projects);
  const project = all.find((p) => p.name.toLowerCase().includes(name.toLowerCase()));
  if (!project) {
    console.log(`no project matching "${name}"`);
    process.exit(1);
  }

  const start = await counts(project.id);
  console.log(
    `${project.name}: ${start.total} leads (${start.withEmail} with email), ${project.discoveryRuns} rounds used, target ${TARGET_LEADS}`,
  );

  const result = await runDiscovery(project.id, { maxRounds: rounds });
  const end = await counts(project.id);
  const [after] = await db.select().from(projects).where(eq(projects.id, project.id));

  console.log(
    `searched ${result.searched} new domains, enriched ${result.enriched}, ${result.withEmail} had an address, stored ${result.saved}`,
  );
  console.log(
    `now: ${end.total} leads (${end.withEmail} with email), ${after?.discoveryRuns} rounds used`,
  );

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
