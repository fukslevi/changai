/** Marks conversations the operator has taken over by hand. */
import { sql } from "drizzle-orm";
import { db } from "../lib/db";

async function main() {
  await db.execute(
    sql`ALTER TABLE supplier_leads ADD COLUMN IF NOT EXISTS taken_over_at timestamptz`,
  );
  console.log("supplier_leads.taken_over_at ready");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
