/**
 * Send one real outreach email to an address you control, with the RFQ deck
 * attached, exactly as a supplier would receive it.
 *
 *   npx tsx --env-file=.env scripts/send-test.ts [recipient] [projectId]
 *
 * Defaults to the sourcing mailbox itself, so running it with no arguments
 * cannot reach anybody outside the company.
 */
import { and, eq } from "drizzle-orm";
import { db, files, projects } from "../lib/db";
import { sendEmail, verifyGmailConnection } from "../lib/mail/gmail";
import { COMPANY_PLACEHOLDER } from "../lib/outreach/template";
import { getSettings } from "../lib/settings";

async function main() {
  const connection = await verifyGmailConnection();
  console.log(`Gmail connected as ${connection.email}\n`);

  const recipient = process.argv[2] ?? connection.email;
  const wantedProject = process.argv[3];

  const all = await db.select().from(projects);
  const project = wantedProject
    ? all.find((p) => p.id === wantedProject)
    : all.find((p) => p.outreachBody);

  if (!project?.outreachBody || !project.outreachSubject) {
    console.error("No project has a generated outreach email yet.");
    process.exit(1);
  }

  const [rfq] = await db
    .select()
    .from(files)
    .where(and(eq(files.projectId, project.id), eq(files.kind, "rfq")))
    .limit(1);

  const settings = await getSettings();

  // Same substitution the real sender does - one message per supplier, the
  // company name filled in. A test run stands in a placeholder name so the
  // rendered result is what a supplier would actually read.
  const body = project.outreachBody.replaceAll(COMPANY_PLACEHOLDER, "Ningbo Example Co., Ltd");

  console.log(`Project   : ${project.name}`);
  console.log(`To        : ${recipient}`);
  console.log(`Subject   : ${project.outreachSubject}`);
  console.log(`From name : ${settings.senderName} | ${settings.companyName}`);
  console.log(`Attachment: ${rfq ? `${rfq.filename} (${Math.round(rfq.sizeBytes / 1024)} KB)` : "none"}\n`);

  const result = await sendEmail({
    to: recipient,
    subject: project.outreachSubject,
    body,
    fromName: `${settings.senderName} | ${settings.companyName}`,
    attachments: rfq
      ? [{ filename: rfq.filename, mimeType: rfq.mimeType, content: rfq.content }]
      : [],
  });

  console.log(`Sent. messageId=${result.messageId} threadId=${result.threadId}`);
  console.log("\nCheck the inbox - confirm the attachment opens and nothing landed in spam.\n");

  process.exit(0);
}

main().catch((err) => {
  console.error(`\n${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
});
