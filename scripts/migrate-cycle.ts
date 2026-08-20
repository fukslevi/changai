/** Records when the scheduled cycle last ran. */
import { sql } from "drizzle-orm";
import { db } from "../lib/db";

async function main() {
  await db.execute(sql`ALTER TABLE settings ADD COLUMN IF NOT EXISTS last_cycle_at timestamptz`);
  console.log("settings.last_cycle_at ready");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
