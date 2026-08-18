/**
 * What the autopilot would do with each open thread. Sends nothing.
 *
 *   npx tsx --env-file=.env scripts/autopilot-dry.ts
 */
import { and, asc, eq, isNull } from "drizzle-orm";
import { db, messages, projects, suppliers } from "../lib/db";
import { planReply, withinSupplierHours } from "../lib/inbox/autopilot";

async function main() {
  const all = await db.select().from(projects);
  const project = all[0];
  if (!project) { console.error("No project"); process.exit(1); }

  console.log(`${project.name}   (China business hours right now: ${withinSupplierHours() ? "yes" : "no"})\n`);

  const pending = await db
    .select({
      id: messages.id,
      supplierId: messages.supplierId,
      company: suppliers.companyName,
      analysis: messages.analysis,
      classification: messages.classification,
    })
    .from(messages)
    .leftJoin(suppliers, eq(messages.supplierId, suppliers.id))
    .where(and(eq(messages.projectId, project.id), eq(messages.direction, "inbound"), isNull(messages.handledAt)))
    .orderBy(asc(messages.receivedAt));

  for (const m of pending) {
    if (!m.supplierId) continue;
    console.log("=".repeat(76));
    console.log(`${m.company}   [${m.classification}]`);

    if (m.classification === "not_relevant") { console.log("  -> auto-closed, not relevant"); continue; }
    const needsJudgement =
      m.analysis?.challenges_a_requirement === true || m.classification === "quotation";
    if (needsJudgement) {
      console.log(`  -> HELD FOR YOU: ${m.analysis?.needs_human_reason}`);
      continue;
    }

    const plan = await planReply({ projectId: project.id, supplierId: m.supplierId });
    if (plan.answerable) {
      console.log("  -> WOULD REPLY AUTOMATICALLY:\n");
      console.log(plan.draft.split("\n").map((l) => `     ${l}`).join("\n"));
    } else {
      console.log("  -> PARKED, needs your answer:");
      for (const q of plan.open_questions) {
        console.log(`     [${q.scope}] ${q.question_he}`);
        console.log(`             למה: ${q.why_he}`);
      }
    }
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
