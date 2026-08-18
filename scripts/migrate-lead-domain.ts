/**
 * Add the domain column, backfill it, collapse duplicates, re-key the index.
 *
 *   npx tsx --env-file=.env scripts/migrate-lead-domain.ts
 *
 * Hand-written rather than generated: the table already holds rows that the new
 * unique index would reject, so the duplicates have to be merged before the
 * index can exist. `drizzle-kit push` would just fail on them.
 *
 * Merge rule: keep the row that carries a real decision, then the one with an
 * email, then the highest score. A rejection must survive - the entire point of
 * the change is that a rejected factory cannot come back under another spelling.
 */
import { sql } from "drizzle-orm";
import { db } from "../lib/db";

function rowsOf(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  const rows = (result as { rows?: unknown }).rows;
  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
}

async function main() {
  await db.execute(
    sql`ALTER TABLE supplier_leads ADD COLUMN IF NOT EXISTS domain text NOT NULL DEFAULT ''`,
  );

  const backfilled = await db.execute(sql`
    UPDATE supplier_leads
       SET domain = lower(regexp_replace(regexp_replace(website, '^https?://', ''), '/.*$', ''))
     WHERE domain = '' AND website IS NOT NULL
  `);
  // The neon-http driver returns a plain array of rows, not a pg Result.
  console.log(`backfilled ${rowsOf(backfilled).length} rows`);

  const dupes = await db.execute(sql`
    WITH ranked AS (
      SELECT id, project_id, domain, company_name,
             row_number() OVER (
               PARTITION BY project_id, domain
               ORDER BY (status <> 'pending') DESC,
                        (email IS NOT NULL) DESC,
                        coalesce(match_score, 0) DESC,
                        created_at ASC
             ) AS rank
        FROM supplier_leads
       WHERE domain <> ''
    )
    DELETE FROM supplier_leads
     WHERE id IN (SELECT id FROM ranked WHERE rank > 1)
    RETURNING company_name, domain
  `);
  for (const row of rowsOf(dupes) as { company_name: string; domain: string }[]) {
    console.log(`  dropped duplicate: ${row.company_name} (${row.domain})`);
  }

  await db.execute(sql`DROP INDEX IF EXISTS supplier_leads_dedupe_idx`);
  await db.execute(
    sql`CREATE UNIQUE INDEX IF NOT EXISTS supplier_leads_domain_idx
        ON supplier_leads (project_id, domain)`,
  );

  console.log("index re-keyed to (project_id, domain)");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
