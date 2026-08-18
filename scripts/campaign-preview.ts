/**
 * Dry run: exactly who would receive the campaign, and what they would read.
 *
 *   npx tsx --env-file=.env scripts/campaign-preview.ts [projectId]
 *
 * Sends nothing. This is the last look before real mail goes to real companies.
 */
import { db, projects } from "../lib/db";
import { campaignStatus, prepareCampaign } from "../lib/outreach/batch";
import { COMPANY_PLACEHOLDER } from "../lib/outreach/template";

async function main() {
  const wanted = process.argv[2];
  const all = await db.select().from(projects);
  const project = wanted ? all.find((p) => p.id === wanted) : all[0];
  if (!project) {
    console.error("No project found.");
    process.exit(1);
  }

  const status = await campaignStatus(project.id);
  const campaign = await prepareCampaign(project.id);

  console.log(`Project    : ${project.name}`);
  console.log(`From       : ${campaign.fromName} <${campaign.mailbox}>`);
  console.log(`Subject    : ${campaign.subject}`);
  console.log(
    `Attachment : ${
      campaign.attachment
        ? `${campaign.attachment.filename} (${Math.round(campaign.attachment.content.length / 1024)} KB)`
        : "NONE"
    }`,
  );
  console.log(`Already out: ${status.sent} sent, ${status.failed} failed\n`);

  console.log(`Would send ${status.pending.length} individual messages:`);
  for (const r of status.pending) {
    console.log(`  ${String(r.matchScore ?? "??").padStart(3)}  ${r.companyName.padEnd(44).slice(0, 44)} ${r.email}`);
  }

  if (status.blocked.length > 0) {
    console.log(`\nApproved but excluded (${status.blocked.length}):`);
    for (const b of status.blocked) console.log(`  ${b.companyName} - ${b.reason}`);
  }

  const first = status.pending[0];
  if (first) {
    console.log(`\n--- as ${first.companyName} would receive it ---\n`);
    console.log(campaign.body.replaceAll(COMPANY_PLACEHOLDER, first.companyName));
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(`\n${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
});
