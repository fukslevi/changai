/**
 * Set a lead's contact address by hand.
 *
 *   npx tsx --env-file=.env scripts/set-lead-email.ts chinabikerack.com sales11@chinabikerack.com
 *
 * The terminal twin of the manual field on the approval screen, for when a site
 * throttles the crawler but a person can still read the contact page.
 */
import { eq } from "drizzle-orm";
import { db, supplierLeads } from "../lib/db";

async function main() {
  const [domain, email] = process.argv.slice(2);
  if (!domain || !email) throw new Error("Usage: set-lead-email.ts <domain> <email>");

  const updated = await db
    .update(supplierLeads)
    .set({ email: email.toLowerCase() })
    .where(eq(supplierLeads.domain, domain.toLowerCase()))
    .returning({ company: supplierLeads.companyName, email: supplierLeads.email });

  if (updated.length === 0) console.log(`No lead stored for ${domain}`);
  for (const row of updated) console.log(`${row.company}: ${row.email}`);

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
