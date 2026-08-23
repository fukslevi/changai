/** Per-project cycle stamp, so the deadline starves a different project each run. */
import { sql } from "drizzle-orm";
import { db } from "../lib/db";

async function main() {
  await db.execute(sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS last_cycled_at timestamptz`);
  console.log("projects.last_cycled_at ready");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
