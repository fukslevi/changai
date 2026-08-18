import { eq } from "drizzle-orm";
import { db, items, projects } from "../lib/db";
import { projectPricing } from "../lib/pricing/project";

async function main() {
  const [project] = await db.select().from(projects);
  if (!project) process.exit(1);
  const rows = await db.select().from(items).where(eq(items.projectId, project.id));
  for (const i of rows) {
    console.log(`${i.kind.padEnd(18)} ${i.name.padEnd(34).slice(0,34)} retail=${i.targetRetailUsd} fba=${i.fbaFeeUsd} cbm=${i.assumedCbmPerUnit}`);
  }
  const p = await projectPricing(project.id);
  console.log(`\npricing.ready=${p.ready} missing=${JSON.stringify(p.missing)} products=${p.products.length}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
