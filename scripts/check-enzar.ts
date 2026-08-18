import { and, eq, like } from "drizzle-orm";
import { db, messages, projects, suppliers } from "../lib/db";

async function main() {
  const [project] = await db.select().from(projects);
  if (!project) process.exit(1);

  console.log("--- does the outreach email state a target price? ---");
  const body = project.outreachBody ?? "";
  const priceLines = body.split("\n").filter((l) => /\$|price|target/i.test(l));
  console.log(priceLines.join("\n") || "(no price line in the email body)");

  console.log("\n--- Enzar triage ---");
  const [enzar] = await db
    .select({ analysis: messages.analysis, handledAt: messages.handledAt, cls: messages.classification })
    .from(messages)
    .leftJoin(suppliers, eq(messages.supplierId, suppliers.id))
    .where(and(eq(messages.projectId, project.id), eq(messages.direction, "inbound"), like(suppliers.companyName, "%Enzar%")));

  console.log(JSON.stringify({ cls: enzar?.cls, handledAt: enzar?.handledAt, needs_human: enzar?.analysis?.needs_human, challenges: enzar?.analysis?.challenges_a_requirement }, null, 2));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
