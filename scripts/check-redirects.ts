/**
 * Addresses that suppliers' own auto-replies handed us.
 *
 * Read-only. Forest Drapery's out-of-office said "please contact
 * sales@forestdh.com" and nothing acted on it - the supplier told us where to
 * write and we filed it as irrelevant.
 */
import { asc } from "drizzle-orm";
import { db, projects } from "../lib/db";
import { findRedirects } from "../lib/inbox/bounces";

async function main() {
  for (const project of await db.select().from(projects).orderBy(asc(projects.createdAt))) {
    if (project.archivedAt) continue;
    const found = await findRedirects(project.id);
    if (found.length === 0) continue;

    console.log(`\n${project.name}`);
    for (const r of found) {
      console.log(`  ${r.company}`);
      console.log(`    ${r.from}  ->  ${r.to}`);
    }
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
