/**
 * Who has gone quiet, and what is due.
 *
 *   npx tsx --env-file=.env scripts/followups.ts           # report only
 *   npx tsx --env-file=.env scripts/followups.ts --send    # send what is due
 */
import { db, projects } from "../lib/db";
import { runFollowUps, silentThreads } from "../lib/inbox/followup";

async function main() {
  const send = process.argv.includes("--send");
  const [project] = await db.select().from(projects);
  if (!project) { console.error("No project"); process.exit(1); }

  const threads = await silentThreads(project.id);
  console.log(`${project.name}: ${threads.length} threads waiting on the supplier\n`);
  console.log("days  chases  ever replied  company");
  for (const t of threads) {
    console.log(
      `${String(t.daysSilent).padStart(4)}  ${String(t.chasesSent).padStart(6)}  ` +
      `${(t.everReplied ? "yes" : "no").padEnd(12)}  ${t.company.slice(0, 44)}` +
      `${t.due ? "   << due" : t.exhausted ? "   << out of chases" : ""}`,
    );
  }

  const result = await runFollowUps(project.id, { send });
  console.log(`\n${send ? "sent" : "would send"}: ${result.chased.length}`);
  for (const c of result.chased) console.log(`  chase #${c.attempt}  ${c.company}`);
  if (result.closed.length) console.log(`closing: ${result.closed.map((c) => c.company).join(", ")}`);

  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
