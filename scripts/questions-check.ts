/** The unified queue, as the page will render it. */
import { db, projects } from "../lib/db";
import { pendingQuestions } from "../lib/questions";

async function main() {
  const [project] = await db.select().from(projects);
  if (!project) process.exit(1);
  const { open, answered } = await pendingQuestions(project.id);
  console.log(`${open.length} open · ${answered.length} answered\n`);
  for (const q of open) {
    console.log(`[${q.kind}] ${q.questionHe}${q.unit ? `  (${q.unit})` : ""}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
