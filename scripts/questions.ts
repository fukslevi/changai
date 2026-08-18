/** The open questions queue. */
import { asc, eq } from "drizzle-orm";
import { db, openQuestions, projects, suppliers } from "../lib/db";

async function main() {
  const all = await db.select().from(projects);
  const project = all[0];
  if (!project) { console.error("No project"); process.exit(1); }

  const rows = await db
    .select({
      company: suppliers.companyName,
      scope: openQuestions.scope,
      questionHe: openQuestions.questionHe,
      whyHe: openQuestions.whyHe,
      status: openQuestions.status,
      answer: openQuestions.answer,
    })
    .from(openQuestions)
    .leftJoin(suppliers, eq(openQuestions.supplierId, suppliers.id))
    .where(eq(openQuestions.projectId, project.id))
    .orderBy(asc(openQuestions.createdAt));

  console.log(`${project.name}: ${rows.filter((r) => r.status === "open").length} open\n`);
  for (const r of rows) {
    console.log(`[${r.status}] [${r.scope === "project" ? "כל הספקים" : r.company}]`);
    console.log(`  ${r.questionHe}`);
    if (r.whyHe) console.log(`  למה: ${r.whyHe}`);
    if (r.answer) console.log(`  תשובה: ${r.answer}`);
    console.log();
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
