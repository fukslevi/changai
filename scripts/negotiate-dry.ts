/**
 * What the agent would say at full autonomy. Sends nothing, saves nothing.
 *
 *   npx tsx --env-file=.env scripts/negotiate-dry.ts hangzhou
 */
import { db, projects } from "../lib/db";
import { conversations } from "../lib/inbox/run";
import { planReply } from "../lib/inbox/autopilot";
import { loadMandate } from "../lib/negotiate/mandate";
import { checkDraft } from "../lib/negotiate/guard";

async function main() {
  const needle = (process.argv[2] ?? "").toLowerCase();
  const [project] = await db.select().from(projects);
  if (!project) process.exit(1);

  // Simulate tier 3 without touching the stored setting.
  const mandate = { ...(await loadMandate(project.id)), tier: 3 };
  mandate.mayNegotiatePrice = mandate.ceilings.length > 0;

  console.log(`mandate: ${mandate.ceilings.length} products, ${mandate.nonNegotiable.length} non-negotiable requirements`);
  for (const c of mandate.ceilings) {
    for (const t of c.tiers) console.log(`  ceiling ${c.itemName} @ ${t.qty}: $${t.walkAwayFob.toFixed(2)} (open at $${t.rfqTargetFob ?? "-"})`);
  }

  const rows = await conversations(project.id);
  const match = rows.find((r) => r.direction === "inbound" && (r.company ?? "").toLowerCase().includes(needle));
  if (!match?.supplierId) { console.error(`no thread matching "${needle}"`); process.exit(1); }

  const plan = await planReply({ projectId: project.id, supplierId: match.supplierId }, mandate);
  console.log(`\n--- would say to ${match.company} ---\n`);
  console.log(plan.answerable ? plan.draft : `PARKED: ${plan.open_questions.map((q) => q.question_he).join(" | ")}`);

  const guard = checkDraft(plan.draft, mandate);
  console.log(`\nguard: ${guard.safe ? "clean" : guard.problems.join(" · ")}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
