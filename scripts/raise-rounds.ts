/** Raise the round cap on existing projects to the new default. */
import { sql } from "drizzle-orm";
import { db, projects } from "../lib/db";

async function main() {
  await db.execute(sql`ALTER TABLE projects ALTER COLUMN max_negotiation_rounds SET DEFAULT 10`);
  const updated = await db
    .update(projects)
    .set({ maxNegotiationRounds: 10 })
    .returning({ name: projects.name });
  for (const r of updated) console.log(`${r.name}: 10 rounds`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
