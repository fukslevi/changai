/**
 * Rebuild and print the outreach email from data already in the database.
 * No model call, so it is instant and free — use it while iterating on the
 * template.
 *
 *   npx tsx --env-file=.env scripts/show-email.ts [projectId]
 */
import { asc, eq, isNotNull } from "drizzle-orm";
import { db, items, projects, requirements } from "../lib/db";
import { buildOutreachEmail } from "../lib/outreach/template";

async function main() {
  const wanted = process.argv[2];

  const candidates = await db
    .select()
    .from(projects)
    .where(isNotNull(projects.quantityTiers))
    .orderBy(asc(projects.createdAt));

  const project = wanted ? candidates.find((p) => p.id === wanted) : candidates[0];
  if (!project) {
    console.log("No project found.");
    process.exit(1);
  }

  const [projectItems, projectRequirements] = await Promise.all([
    db.select().from(items).where(eq(items.projectId, project.id)),
    db.select().from(requirements).where(eq(requirements.projectId, project.id)),
  ]);

  if (projectItems.length === 0) {
    console.log(`${project.name} has no parsed items — run parse-and-generate.ts first.`);
    process.exit(1);
  }

  const email = buildOutreachEmail(project, projectItems, projectRequirements, {
    name: process.env.SOURCING_SENDER_NAME ?? "Sourcing",
    title: process.env.SOURCING_SENDER_TITLE ?? "Sourcing",
  });

  await db
    .update(projects)
    .set({ outreachSubject: email.subject, outreachBody: email.body })
    .where(eq(projects.id, project.id));

  console.log("─".repeat(78));
  console.log(`Subject: ${email.subject}`);
  console.log("─".repeat(78));
  console.log(email.body);
  console.log("─".repeat(78));

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
