/** What came back, per supplier. */
import { db, projects } from "../lib/db";
import { conversations } from "../lib/inbox/run";

async function main() {
  const all = await db.select().from(projects);
  const project = all[0];
  if (!project) { console.error("No project"); process.exit(1); }

  const rows = (await conversations(project.id)).filter((r) => r.direction === "inbound");
  console.log(`${project.name}: ${rows.length} replies\n`);

  for (const r of rows) {
    console.log("=".repeat(78));
    console.log(`${r.company ?? r.supplierEmail}   [${r.classification}]`);
    console.log(`from: ${r.supplierEmail}   ${r.receivedAt.toISOString().slice(0,16).replace("T"," ")}`);
    const a = r.analysis;
    if (a) {
      console.log(`\n  ${a.summary_he}`);
      if (a.answered.length) console.log(`\n  ענה על: ${a.answered.join(" | ")}`);
      if (a.missing.length) console.log(`  חסר   : ${a.missing.join(", ")}`);
      if (a.questions_from_supplier.length) console.log(`  שאל   : ${a.questions_from_supplier.join(" | ")}`);
      if (a.challenges_a_requirement) console.log(`  !! חולק על דרישה: ${a.challenge_detail}`);
      if (a.needs_human) console.log(`  >> דורש אדם: ${a.needs_human_reason}`);
    }
    if (r.attachments.length) console.log(`\n  קבצים: ${r.attachments.map((x) => x.filename).join(", ")}`);
    console.log(`\n  --- body ---\n${(r.bodyText ?? "").slice(0, 700)}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
