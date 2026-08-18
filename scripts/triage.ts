/**
 * Triage open threads and park what needs a person. Sends nothing.
 *
 *   npx tsx --env-file=.env scripts/triage.ts
 */
import { db, projects } from "../lib/db";
import { triageAndPark } from "../lib/inbox/autopilot";

async function main() {
  const all = await db.select().from(projects);
  const project = all[0];
  if (!project) { console.error("No project"); process.exit(1); }

  const r = await triageAndPark(project.id);

  console.log(`${project.name}\n`);
  for (const x of r.readyToSend) console.log(`READY   ${x.company} - draft is written, waiting on send`);
  for (const x of r.parked) console.log(`PARKED  ${x.company} - ${x.questions.length} question(s)`);
  for (const x of r.waitingOnAnswers) console.log(`WAITING ${x.company} - ${x.questions} open`);
  for (const x of r.heldForHuman) console.log(`HELD    ${x.company} - ${x.reason}`);

  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
