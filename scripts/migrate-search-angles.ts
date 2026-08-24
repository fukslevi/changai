/** Store for the product-specific search angles. */
import { sql } from "drizzle-orm";
import { db } from "../lib/db";

async function main() {
  await db.execute(sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS search_angles jsonb`);
  console.log("projects.search_angles ready");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
