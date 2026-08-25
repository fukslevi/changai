/**
 * Add a supplier by URL against a real project, then remove it.
 *
 * The interesting part is not the insert - it is whether the site actually
 * yields an address and a sensible score, which nothing but a live fetch can
 * tell you.
 */
import { and, eq, inArray } from "drizzle-orm";
import { db, projects, supplierLeads } from "../lib/db";
import { addSuppliersByUrl } from "../lib/discovery/manual";

async function main() {
  const name = process.argv[2] ?? "LED";
  const urls = process.argv.slice(3);
  if (urls.length === 0) {
    console.log("usage: check-manual-add <project> <url> [url...]");
    process.exit(1);
  }

  const all = await db.select().from(projects);
  const project = all.find((p) => p.name.toLowerCase().includes(name.toLowerCase()));
  if (!project) {
    console.log(`no project matching "${name}"`);
    process.exit(1);
  }

  const before = await db
    .select({ domain: supplierLeads.domain })
    .from(supplierLeads)
    .where(eq(supplierLeads.projectId, project.id));
  const knownBefore = new Set(before.map((r) => r.domain));

  console.log(`${project.name}: ${before.length} leads before\n`);

  const data = new FormData();
  data.set("projectId", project.id);
  data.set("urls", urls.join("\n"));

  const result = await addSuppliersByUrl({}, data);

  if (result.error) console.log(`error: ${result.error}`);
  if (result.ok) console.log(result.ok);

  for (const supplier of result.added ?? []) {
    console.log(`\n  ${supplier.companyName}`);
    console.log(`    domain: ${supplier.domain}`);
    console.log(`    email:  ${supplier.email ?? "(none found)"}`);
    console.log(`    score:  ${supplier.matchScore ?? "-"}`);
    if (supplier.problemHe) console.log(`    note:   ${supplier.problemHe}`);
  }

  // Remove only what this run created.
  const added = (result.added ?? [])
    .filter((a) => !a.alreadyKnown && !knownBefore.has(a.domain))
    .map((a) => a.domain);

  if (added.length > 0) {
    await db
      .delete(supplierLeads)
      .where(
        and(eq(supplierLeads.projectId, project.id), inArray(supplierLeads.domain, added)),
      );
    console.log(`\ncleaned up ${added.length} test leads`);
  }

  const after = await db
    .select({ domain: supplierLeads.domain })
    .from(supplierLeads)
    .where(eq(supplierLeads.projectId, project.id));
  console.log(`${after.length} leads after (was ${before.length})`);

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
