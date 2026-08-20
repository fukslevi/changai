/** Why a project is not moving. */
import { eq } from "drizzle-orm";
import { db, items, projects, supplierLeads } from "../lib/db";
import { campaignStatus } from "../lib/outreach/batch";
import { projectPricing } from "../lib/pricing/project";
import { pendingQuestions } from "../lib/questions";

async function main() {
  const needle = (process.argv[2] ?? "").toLowerCase();
  const all = await db.select().from(projects);
  const project = needle ? all.find((p) => p.name.toLowerCase().includes(needle)) : all[0];
  if (!project) { console.error("no project"); process.exit(1); }

  const rows = await db.select().from(items).where(eq(items.projectId, project.id));
  const leads = await db.select().from(supplierLeads).where(eq(supplierLeads.projectId, project.id));
  const pricing = await projectPricing(project.id);
  const { open } = await pendingQuestions(project.id);
  const campaign = await campaignStatus(project.id);

  console.log(`${project.name}`);
  console.log(`  autonomy        : ${project.autonomyTier}`);
  console.log(`  rfq file        : ${project.sourceRfqFile ?? "none"}`);
  console.log(`  items parsed    : ${rows.length}`);
  console.log(`  outreach email  : ${project.outreachBody ? "written" : "MISSING"}`);
  console.log(`  keywords        : ${project.keywords.join(" | ")}`);
  console.log(`  leads           : ${leads.length} (${leads.filter(l => l.status === "pending").length} pending, ${leads.filter(l => l.status === "approved").length} approved)`);
  console.log(`  with email      : ${leads.filter(l => l.email).length}`);
  console.log(`  pricing ready   : ${pricing.ready}  missing: ${pricing.missing.join(", ") || "-"}`);
  console.log(`  open questions  : ${open.length}`);
  console.log(`  ready to send   : ${campaign.pending.length}`);
  console.log(`  blocked to send : ${campaign.blocked.map(b => b.companyName + " (" + b.reason + ")").join("; ") || "-"}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
