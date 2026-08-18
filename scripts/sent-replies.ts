/** Outbound messages we sent after the first campaign email. */
import { and, asc, eq } from "drizzle-orm";
import { db, messages, projects, suppliers } from "../lib/db";

async function main() {
  const all = await db.select().from(projects);
  const project = all[0];
  if (!project) { console.error("No project"); process.exit(1); }

  const rows = await db
    .select({
      company: suppliers.companyName,
      body: messages.bodyText,
      at: messages.receivedAt,
      subject: messages.subject,
    })
    .from(messages)
    .leftJoin(suppliers, eq(messages.supplierId, suppliers.id))
    .where(and(eq(messages.projectId, project.id), eq(messages.direction, "outbound")))
    .orderBy(asc(messages.receivedAt));

  const replies = rows.filter((r) => (r.subject ?? "").startsWith("Re: "));
  console.log(`${replies.length} replies sent\n`);
  for (const r of replies) {
    console.log("=".repeat(74));
    console.log(`${r.company}   ${r.at.toISOString().slice(5, 16).replace("T", " ")}`);
    console.log((r.body ?? "").slice(0, 900));
    console.log();
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
