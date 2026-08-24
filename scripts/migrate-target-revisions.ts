/** History for target prices. */
import { sql } from "drizzle-orm";
import { db } from "../lib/db";

async function main() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS target_revisions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      item_id uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      qty integer,
      previous_usd numeric(10,2),
      new_usd numeric(10,2) NOT NULL,
      reason_he text,
      changed_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS target_revisions_project_idx
      ON target_revisions (project_id, item_id)
  `);
  console.log("target_revisions ready");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
