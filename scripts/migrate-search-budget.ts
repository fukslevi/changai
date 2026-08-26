/** Daily round counter for the search. */
import { sql } from "drizzle-orm";
import { db } from "../lib/db";

async function main() {
  await db.execute(
    sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS discovery_rounds_today integer NOT NULL DEFAULT 0`,
  );
  await db.execute(sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS discovery_day text`);
  console.log("search budget columns ready");
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
