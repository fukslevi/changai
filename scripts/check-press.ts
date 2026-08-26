/** What the price-ask would say. Dry run - sends nothing. */
import { asc } from "drizzle-orm";
import { db, projects } from "../lib/db";
import { pressForPrice } from "../lib/inbox/press";

async function main() {
  const name = process.argv[2];
  const limit = Number(process.argv[3] ?? 2);

  for (const project of await db.select().from(projects).orderBy(asc(projects.createdAt))) {
    if (name && !project.name.toLowerCase().includes(name.toLowerCase())) continue;

    const result = await pressForPrice(project.id, { send: false, limit });
    if (result.candidates.length === 0) continue;

    console.log(`\n=== ${project.name}: ${result.candidates.length} replied without a price ===`);
    for (const c of result.candidates) {
      console.log(`  ${c.company}${c.refusedTarget ? "  [refused the target]" : ""}`);
    }

    for (const ask of result.asked) {
      console.log(`\n--- draft to ${ask.company} ---`);
      console.log(ask.draft.split("\n").map((l) => `    ${l}`).join("\n"));
    }
    for (const s of result.skipped) console.log(`  skipped ${s.company}: ${s.reason}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
