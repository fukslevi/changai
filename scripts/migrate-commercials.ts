/**
 * Add the commercial model columns.
 *
 *   npx tsx --env-file=.env scripts/migrate-commercials.ts
 */
import { sql } from "drizzle-orm";
import { db } from "../lib/db";

const PROJECT_COLUMNS: [string, string][] = [
  ["target_roi", "numeric(4,2)"],
  ["ppc_pct", "numeric(5,2)"],
  ["roi_after_ppc", "boolean NOT NULL DEFAULT true"],
  ["referral_pct", "numeric(5,2)"],
  ["hs_code", "text"],
  ["duty_rate_pct", "numeric(5,2)"],
  ["freight_usd_per_cbm", "numeric(8,2)"],
  ["inbound_usd_per_unit", "numeric(8,2)"],
];

const ITEM_COLUMNS: [string, string][] = [
  ["target_retail_usd", "numeric(10,2)"],
  ["fba_fee_usd", "numeric(8,2)"],
  ["assumed_cbm_per_unit", "numeric(8,5)"],
];

async function main() {
  for (const [name, type] of PROJECT_COLUMNS) {
    await db.execute(
      sql.raw(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS ${name} ${type}`),
    );
  }
  for (const [name, type] of ITEM_COLUMNS) {
    await db.execute(sql.raw(`ALTER TABLE items ADD COLUMN IF NOT EXISTS ${name} ${type}`));
  }
  console.log(`projects: +${PROJECT_COLUMNS.length} columns · items: +${ITEM_COLUMNS.length}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
