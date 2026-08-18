/**
 * What actually left the building, per supplier.
 *
 *   npx tsx --env-file=.env scripts/outreach-log.ts [projectId]
 */
import { asc, eq } from "drizzle-orm";
import { db, outreach, projects, suppliers } from "../lib/db";

async function main() {
  const wanted = process.argv[2];
  const all = await db.select().from(projects);
  const project = wanted ? all.find((p) => p.id === wanted) : all[0];
  if (!project) {
    console.error("No project found.");
    process.exit(1);
  }

  const rows = await db
    .select({
      company: suppliers.companyName,
      email: suppliers.email,
      status: outreach.status,
      sentAt: outreach.sentAt,
      threadId: outreach.gmailThreadId,
      error: outreach.error,
    })
    .from(outreach)
    .innerJoin(suppliers, eq(outreach.supplierId, suppliers.id))
    .where(eq(outreach.projectId, project.id))
    .orderBy(asc(outreach.createdAt));

  console.log(`${project.name}: ${rows.length} outreach rows\n`);
  for (const r of rows) {
    const when = r.sentAt ? r.sentAt.toISOString().slice(11, 19) : "--:--:--";
    console.log(
      `${r.status.padEnd(7)} ${when}  ${(r.company ?? "").padEnd(38).slice(0, 38)} ${r.threadId ?? r.error ?? ""}`,
    );
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
