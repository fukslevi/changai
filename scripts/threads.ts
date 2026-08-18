/** Message counts and last activity per supplier. */
import { db, projects } from "../lib/db";
import { conversations } from "../lib/inbox/run";

async function main() {
  const all = await db.select().from(projects);
  const project = all[0];
  if (!project) { console.error("No project"); process.exit(1); }

  const rows = await conversations(project.id);
  const by = new Map<string, { company: string; out: number; in: number; last: Date; lastDir: string; handled: boolean }>();

  for (const r of rows) {
    if (!r.supplierId) continue;
    const cur = by.get(r.supplierId) ?? {
      company: r.company ?? "?", out: 0, in: 0, last: r.receivedAt, lastDir: r.direction, handled: true,
    };
    if (r.direction === "inbound") { cur.in++; cur.handled = Boolean(r.handledAt); } else cur.out++;
    if (r.receivedAt >= cur.last) { cur.last = r.receivedAt; cur.lastDir = r.direction; }
    cur.company = r.company ?? cur.company;
    by.set(r.supplierId, cur);
  }

  console.log(`${project.name}\n`);
  console.log("out  in  last            who spoke last   company");
  for (const t of [...by.values()].sort((a, b) => b.last.getTime() - a.last.getTime())) {
    console.log(
      `${String(t.out).padStart(3)} ${String(t.in).padStart(3)}  ` +
      `${t.last.toISOString().slice(5, 16).replace("T", " ")}   ` +
      `${(t.lastDir === "outbound" ? "אנחנו" : "הספק").padEnd(14)} ${t.company.slice(0, 40)}`,
    );
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
