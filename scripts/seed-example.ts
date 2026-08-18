/**
 * Creates the Rear Bike Basket example project — the keywords are the ones
 * shown as placeholders on /projects/new.
 *
 *   npx tsx --env-file=.env scripts/seed-example.ts
 *
 * Writes straight to Postgres rather than going through the server action, so
 * it works headlessly. Re-running replaces the example rather than duplicating.
 */
import { eq } from "drizzle-orm";
import { db, projects } from "../lib/db";

const NAME = "Rear Bike Basket";

const KEYWORDS = [
  "rear bike basket",
  "bicycle rear rack basket",
  "bike cargo basket",
  "metal bicycle basket manufacturer",
  "bike basket factory china",
];

async function main() {
  await db.delete(projects).where(eq(projects.name, NAME));

  const [created] = await db
    .insert(projects)
    .values({
      name: NAME,
      keywords: KEYWORDS,
      status: "draft",
      // Read from the RFQ's pricing table during parsing — never assumed here.
      quantityTiers: [],
      currency: "USD",
    })
    .returning();

  if (!created) throw new Error("Insert returned no row");

  console.log(`Created project ${created.id}`);
  console.log(`  name:     ${created.name}`);
  console.log(`  keywords: ${created.keywords.length}`);
  for (const k of created.keywords) console.log(`    · ${k}`);
  console.log(`\n  http://localhost:3000/projects/${created.id}`);

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
