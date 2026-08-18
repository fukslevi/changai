/** Target prices per item, as parsed from the RFQ. */
import { asc, eq } from "drizzle-orm";
import { db, items, projects } from "../lib/db";

async function main() {
  const all = await db.select().from(projects);
  const project = all[0];
  if (!project) { console.error("No project"); process.exit(1); }

  const rows = await db.select().from(items).where(eq(items.projectId, project.id)).orderBy(asc(items.name));
  console.log(`${project.name}  ·  tiers: ${project.quantityTiers.join(" / ")}\n`);
  for (const i of rows) {
    const prices = i.targetPrices.map((p) => `${p.qty ?? "-"}: $${p.unit_price ?? "?"}`).join("   ");
    console.log(`${i.kind.padEnd(18)} ${i.name.padEnd(38).slice(0,38)} ${prices || "(no target price)"}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
