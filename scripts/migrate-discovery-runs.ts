/** Counts discovery passes so top-ups can be bounded. */
import { sql } from "drizzle-orm";
import { db } from "../lib/db";

async function main() {
  await db.execute(
    sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS discovery_runs integer NOT NULL DEFAULT 0`,
  );
  // Projects that already have leads have had at least one pass.
  await db.execute(sql`
    UPDATE projects p SET discovery_runs = 1
     WHERE discovery_runs = 0
       AND EXISTS (SELECT 1 FROM supplier_leads l WHERE l.project_id = p.id)
  `);
  console.log("projects.discovery_runs ready");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
