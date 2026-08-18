/**
 * Re-crawl every stored lead that has no contact address.
 *
 *   npx tsx --env-file=.env scripts/refresh-emails.ts [projectId]
 *
 * Same work the "חפש מייל" button does, from the terminal.
 */
import { and, eq, isNull } from "drizzle-orm";
import { db, supplierLeads } from "../lib/db";
import { enrichDomain } from "../lib/discovery/enrich";

async function main() {
  const projectId = process.argv[2];

  const rows = await db
    .select()
    .from(supplierLeads)
    .where(
      projectId
        ? and(eq(supplierLeads.projectId, projectId), isNull(supplierLeads.email))
        : isNull(supplierLeads.email),
    );

  console.log(`${rows.length} leads without an email\n`);

  for (const lead of rows) {
    if (!lead.website) continue;
    const domain = lead.website.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    const contact = await enrichDomain(domain, { seedUrl: lead.sourceUrl ?? undefined });

    if (contact.primaryEmail) {
      await db
        .update(supplierLeads)
        .set({ email: contact.primaryEmail })
        .where(eq(supplierLeads.id, lead.id));
    }

    console.log(
      `${contact.primaryEmail ? "OK  " : "--  "} ${domain.padEnd(28)} ` +
        `${contact.pagesFetched} pages · ${contact.emails.join(", ") || "no address found"}`,
    );
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
