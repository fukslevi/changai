/**
 * Creates a screening-mode test project: Digital Wall Calendar, 10" screen.
 *
 *   npx tsx --env-file=.env scripts/seed-digital-wall-calendar.ts
 *
 * Exercises the new screening path end to end: no RFQ, one item, a single
 * all-in target price the operator already computed (100% ROI at $32.50
 * landed, including shipping from China). Writes straight to Postgres, same
 * pattern as seed-example.ts. Re-running replaces the project rather than
 * duplicating it.
 */
import { eq } from "drizzle-orm";
import { db, items, projects } from "../lib/db";

const NAME = "Digital Wall Calendar";
const TARGET_USD = 32.5;
const QUANTITY_TIERS = [500, 1000, 3000];

const KEYWORDS = [
  "digital wall calendar",
  "10 inch smart calendar display",
  "digital calendar screen manufacturer",
  "smart display factory china",
];

async function main() {
  await db.delete(projects).where(eq(projects.name, NAME));

  const [created] = await db
    .insert(projects)
    .values({
      name: NAME,
      keywords: KEYWORDS,
      status: "draft",
      projectMode: "screening",
      autonomyTier: 3,
      maxNegotiationRounds: 3,
      quantityTiers: QUANTITY_TIERS,
      currency: "USD",
    })
    .returning();

  if (!created) throw new Error("Insert returned no row");

  await db.insert(items).values({
    projectId: created.id,
    name: `${NAME} - 10" screen`,
    kind: "priced_variant",
    targetPrices: QUANTITY_TIERS.map((qty) => ({
      option_id: null,
      qty,
      unit_price: TARGET_USD,
      currency: "USD",
    })),
  });

  console.log(`Created project ${created.id}`);
  console.log(`  name:   ${created.name}`);
  console.log(`  mode:   ${created.projectMode}`);
  console.log(`  target: $${TARGET_USD.toFixed(2)} landed, at ${QUANTITY_TIERS.join(" / ")} pcs`);
  console.log(`\n  http://localhost:3000/projects/${created.id}`);

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
