/** Requirements matching a term, to answer "is this already in the RFQ?". */
import { eq } from "drizzle-orm";
import { db, projects, requirements } from "../lib/db";

async function main() {
  const needle = (process.argv[2] ?? "").toLowerCase();
  const [project] = await db.select().from(projects);
  if (!project) process.exit(1);

  const rows = await db.select().from(requirements).where(eq(requirements.projectId, project.id));
  const hits = rows.filter(
    (r) => r.text.toLowerCase().includes(needle) || r.category.includes(needle),
  );
  console.log(`${hits.length} of ${rows.length} requirements match "${needle}"\n`);
  for (const r of hits) {
    console.log(`[${r.category}] ${r.isMandatory ? "חובה" : "רצוי"}  ${r.text}`);
    console.log(`   source: ${r.sourceSection ?? "-"}\n`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
