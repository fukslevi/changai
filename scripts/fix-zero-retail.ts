/** Clear retail prices that were written as zero rather than left empty. */
import { and, eq, sql } from "drizzle-orm";
import { db, items } from "../lib/db";

async function main() {
  const cleared = await db
    .update(items)
    .set({ targetRetailUsd: null })
    .where(and(eq(items.kind, "priced_variant"), sql`${items.targetRetailUsd} = 0`))
    .returning({ name: items.name });
  for (const r of cleared) console.log(`cleared ${r.name}`);
  console.log(`${cleared.length} rows`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
