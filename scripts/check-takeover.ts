/** Which conversations are the operator's, and what that did to the project. */
import { eq, isNotNull } from "drizzle-orm";
import { db, projects, supplierLeads } from "../lib/db";
import { loadMandate } from "../lib/negotiate/mandate";

async function main() {
  const claimed = await db
    .select({
      projectId: supplierLeads.projectId,
      company: supplierLeads.companyName,
      at: supplierLeads.takenOverAt,
    })
    .from(supplierLeads)
    .where(isNotNull(supplierLeads.takenOverAt));

  if (claimed.length === 0) console.log("no conversation has been taken over");

  for (const row of claimed) {
    const project = (await db.select().from(projects).where(eq(projects.id, row.projectId)))[0]!;
    console.log(`${row.company} <- taken over ${row.at?.toISOString()}`);
    console.log(`  project: ${project.name}`);
    console.log(`  autonomyTier: ${project.autonomyTier} (3 = autonomous)`);
  }

  for (const project of await db.select().from(projects)) {
    const mandate = await loadMandate(project.id);
    const count = claimed.filter((c) => c.projectId === project.id).length;
    console.log(
      `${project.name}: tier ${project.autonomyTier}, mayNegotiatePrice=${mandate.mayNegotiatePrice}, taken over ${count}`,
    );
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
