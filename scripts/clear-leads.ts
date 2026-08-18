/**
 * Delete stored leads so discovery can be re-run from a clean slate.
 *
 *   npx tsx --env-file=.env scripts/clear-leads.ts [projectId]
 *
 * A proper script rather than `tsx -e`: package.json has no "type": "module",
 * so top-level await in an inline -e snippet fails silently and the delete
 * never happens - which is exactly how two discovery runs got merged.
 */
import { eq } from "drizzle-orm";
import { db, projects, supplierLeads } from "../lib/db";

async function main() {
  const wanted = process.argv[2];

  if (wanted) {
    const deleted = await db
      .delete(supplierLeads)
      .where(eq(supplierLeads.projectId, wanted))
      .returning({ id: supplierLeads.id });
    console.log(`Deleted ${deleted.length} leads for project ${wanted}`);
  } else {
    const all = await db.select().from(projects);
    const deleted = await db.delete(supplierLeads).returning({ id: supplierLeads.id });
    console.log(`Deleted ${deleted.length} leads across ${all.length} projects`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
