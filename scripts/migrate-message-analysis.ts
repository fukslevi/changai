/**
 * Add the reply-triage columns to messages.
 *
 *   npx tsx --env-file=.env scripts/migrate-message-analysis.ts
 */
import { sql } from "drizzle-orm";
import { db } from "../lib/db";

async function main() {
  await db.execute(sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS analysis jsonb`);
  await db.execute(
    sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS handled_at timestamptz`,
  );
  console.log("messages: analysis + handled_at ready");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
