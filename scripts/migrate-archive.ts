/** The archive flag. */
import { sql } from "drizzle-orm";
import { db } from "../lib/db";

async function main() {
  await db.execute(sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS archived_at timestamptz`);
  console.log("projects.archived_at ready");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
