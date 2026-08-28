/**
 * Rebuild the stored RFQ email from the current template.
 *
 *   npx tsx --env-file=.env scripts/refresh-outreach-email.ts [--apply]
 *
 * The email is generated once and written to projects.outreach_body, and every
 * later send reads that column - so a change to the template reaches new
 * projects only. The five live projects were still carrying the email built
 * before the kit parts were itemised, and Electric Lunch Box had sixteen
 * approved suppliers waiting to receive it.
 *
 * The column is not purely a cache: the email can be edited by hand on the
 * project page, and a rebuild would discard that. So nothing is written without
 * --apply, and the diff prints first.
 */
import { asc, eq, isNull } from "drizzle-orm";
import { db, items, projects, requirements } from "../lib/db";
import { getSettings } from "../lib/settings";
import { buildOutreachEmail } from "../lib/outreach/template";

function diff(before: string, after: string): string[] {
  const a = before.split("\n");
  const b = after.split("\n");
  const kept = new Set(b);
  const added = new Set(a);
  const out: string[] = [];
  for (const line of a) if (!kept.has(line)) out.push(`  - ${line}`);
  for (const line of b) if (!added.has(line)) out.push(`  + ${line}`);
  return out;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const settings = await getSettings();

  const live = await db
    .select()
    .from(projects)
    .where(isNull(projects.archivedAt))
    .orderBy(asc(projects.createdAt));

  let changed = 0;

  for (const project of live) {
    const [projectItems, projectRequirements] = await Promise.all([
      db.select().from(items).where(eq(items.projectId, project.id)).orderBy(asc(items.name)),
      db.select().from(requirements).where(eq(requirements.projectId, project.id)),
    ]);

    if (projectItems.length === 0) {
      console.log(`${project.name}: no parsed items, skipped`);
      continue;
    }

    const { subject, body } = buildOutreachEmail(project, projectItems, projectRequirements, {
      name: settings.senderName,
      title: settings.senderTitle,
    });

    const sameBody = body === (project.outreachBody ?? "");
    const sameSubject = subject === (project.outreachSubject ?? "");
    if (sameBody && sameSubject) {
      console.log(`${project.name}: already current`);
      continue;
    }

    changed++;
    console.log(`\n=== ${project.name} ===`);
    if (!sameSubject) {
      console.log(`  subject  - ${project.outreachSubject}`);
      console.log(`  subject  + ${subject}`);
    }
    const lines = diff(project.outreachBody ?? "", body);
    console.log(lines.join("\n"));
    console.log(
      `  (${(project.outreachBody ?? "").length} chars -> ${body.length} chars)`,
    );

    if (apply) {
      await db
        .update(projects)
        .set({ outreachSubject: subject, outreachBody: body })
        .where(eq(projects.id, project.id));
      console.log("  written");
    }
  }

  console.log(
    `\n${changed} of ${live.length} live projects ${apply ? "rebuilt" : "would change - rerun with --apply"}`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
