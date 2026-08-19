/** Is the project autonomous, and is anything actually moving? */
import { eq } from "drizzle-orm";
import { db, messages, outreach, projects } from "../lib/db";
import { loadMandate } from "../lib/negotiate/mandate";
import { pendingQuestions } from "../lib/questions";
import { campaignStatus } from "../lib/outreach/batch";

async function main() {
  for (const p of await db.select().from(projects)) {
    const mandate = await loadMandate(p.id);
    const { open } = await pendingQuestions(p.id);
    const campaign = await campaignStatus(p.id);
    const rows = await db.select().from(outreach).where(eq(outreach.projectId, p.id));
    const msgs = await db.select().from(messages).where(eq(messages.projectId, p.id));

    const live = rows.filter((r) => r.status === "sent" || r.status === "replied").length;
    const lastActivity = msgs
      .map((m) => m.receivedAt.getTime())
      .sort((a, b) => b - a)[0];

    console.log(`${p.name}`);
    console.log(`  autonomy tier      : ${p.autonomyTier} (${p.autonomyTier >= 3 ? "אוטונומי" : "מלווה"})`);
    console.log(`  may negotiate      : ${mandate.mayNegotiatePrice}`);
    console.log(`  blocked reason     : ${mandate.blockedReason ?? "-"}`);
    console.log(`  sample budget      : $${mandate.sampleBudgetUsd}`);
    console.log(`  tooling budget     : $${mandate.maxToolingUsd}`);
    console.log(`  max rounds         : ${mandate.maxRounds}`);
    console.log(`  open questions     : ${open.length}`);
    console.log(`  live threads       : ${live}`);
    console.log(`  waiting to send    : ${campaign.pending.length}`);
    console.log(`  last activity      : ${lastActivity ? new Date(lastActivity).toISOString().slice(0, 16).replace("T", " ") : "never"}`);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
