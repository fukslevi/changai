/** Show a thread exactly as Gmail has it, to settle what was actually received. */
import { eq, like, and } from "drizzle-orm";
import { db, outreach, projects, suppliers } from "../lib/db";
import { gmailClient } from "../lib/mail/gmail";

async function main() {
  const needle = process.argv[2] ?? "";
  const [project] = await db.select().from(projects);
  if (!project) process.exit(1);

  const [row] = await db
    .select({ threadId: outreach.gmailThreadId, company: suppliers.companyName })
    .from(outreach)
    .innerJoin(suppliers, eq(outreach.supplierId, suppliers.id))
    .where(and(eq(outreach.projectId, project.id), like(suppliers.companyName, `%${needle}%`)));

  if (!row?.threadId) { console.error(`no thread for "${needle}"`); process.exit(1); }
  console.log(`${row.company}  thread ${row.threadId}\n`);

  const thread = await gmailClient().users.threads.get({ userId: "me", id: row.threadId, format: "full" });
  for (const m of thread.data.messages ?? []) {
    const h = Object.fromEntries((m.payload?.headers ?? []).map((x) => [x.name, x.value]));
    const parts: string[] = [];
    const walk = (p: any) => { if (p?.filename) parts.push(p.filename); (p?.parts ?? []).forEach(walk); };
    walk(m.payload);
    console.log(`id=${m.id}`);
    console.log(`  From   : ${h.From}`);
    console.log(`  Date   : ${h.Date}`);
    console.log(`  Subject: ${h.Subject}`);
    console.log(`  Files  : ${parts.filter(Boolean).join(", ") || "-"}`);
    console.log(`  Snippet: ${(m.snippet ?? "").slice(0, 140)}\n`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
