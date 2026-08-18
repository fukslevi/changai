/**
 * Full chain, headless: parse the uploaded RFQ, persist it, build the outreach
 * email, and print it.
 *
 *   npx tsx --env-file=.env scripts/parse-and-generate.ts [projectId]
 *
 * Same code paths the UI buttons use — persistExtraction and buildOutreachEmail
 * are shared, so what prints here is what the app produces.
 */
import { asc, eq } from "drizzle-orm";
import { db, files, items, projects, requirements } from "../lib/db";
import { buildOutreachEmail } from "../lib/outreach/template";
import { parseRfq } from "../lib/rfq/parse";
import { persistExtraction } from "../lib/rfq/persist";

async function main() {
  const wanted = process.argv[2];

  const rows = await db
    .select({
      projectId: files.projectId,
      filename: files.filename,
      mimeType: files.mimeType,
      content: files.content,
    })
    .from(files)
    .where(eq(files.kind, "rfq"));

  const target = wanted ? rows.find((r) => r.projectId === wanted) : rows[0];
  if (!target?.projectId) {
    console.log("No RFQ uploaded on any project yet.");
    process.exit(1);
  }
  const projectId = target.projectId;

  console.time("parse");
  const { extraction, usage } = await parseRfq({
    filename: target.filename,
    mimeType: target.mimeType,
    content: target.content,
  });
  console.timeEnd("parse");

  const summary = await persistExtraction(projectId, extraction);
  console.log(
    `persisted: ${summary.items} items · ${summary.requirements} requirements · ${summary.issues} issues`,
  );
  console.log(`tokens: ${usage.input_tokens} in / ${usage.output_tokens} out\n`);

  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  const [projectItems, projectRequirements] = await Promise.all([
    db.select().from(items).where(eq(items.projectId, projectId)).orderBy(asc(items.name)),
    db.select().from(requirements).where(eq(requirements.projectId, projectId)),
  ]);
  if (!project) throw new Error("Project vanished");

  const email = buildOutreachEmail(project, projectItems, projectRequirements, {
    name: process.env.SOURCING_SENDER_NAME ?? "Sourcing",
    title: process.env.SOURCING_SENDER_TITLE ?? "Sourcing",
  });

  await db
    .update(projects)
    .set({ outreachSubject: email.subject, outreachBody: email.body })
    .where(eq(projects.id, projectId));

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
