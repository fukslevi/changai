/**
 * Project-level autonomy and its spending limits.
 *
 *   npx tsx --env-file=.env scripts/migrate-autonomy.ts
 */
import { sql } from "drizzle-orm";
import { db } from "../lib/db";

const COLUMNS: [string, string][] = [
  ["autonomy_tier", "integer NOT NULL DEFAULT 1"],
  ["sample_budget_usd", "numeric(10,2)"],
  ["max_tooling_usd", "numeric(10,2)"],
  ["allow_spec_substitution", "boolean NOT NULL DEFAULT false"],
  ["max_negotiation_rounds", "integer NOT NULL DEFAULT 4"],
];

async function main() {
  for (const [name, type] of COLUMNS) {
    await db.execute(sql.raw(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS ${name} ${type}`));
  }
  console.log(`projects: +${COLUMNS.length} autonomy columns (tier defaults to 1)`);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
