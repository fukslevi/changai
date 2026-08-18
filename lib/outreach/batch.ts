/**
 * The outbound campaign: one individual email per approved supplier.
 *
 * Never a shared BCC. A BCC to twenty factories reads to a spam filter as bulk
 * mail, shows every recipient your whole shortlist, and leaves no way to tell
 * whose reply belongs to which send. Separate messages cost nothing here and
 * each one carries its own Gmail threadId, which is what lets an inbound reply
 * be matched back to a supplier later.
 *
 * Sending is deliberately one-at-a-time rather than a loop inside a single
 * request. Mail that has left the building cannot be recalled, so every send is
 * its own committed step: the row is written before the message goes out, the
 * caller controls the pace, and stopping half way leaves a coherent record
 * rather than an unknown number of delivered messages.
 */
import { and, eq, isNotNull } from "drizzle-orm";
import { db, files, outreach, messages, projects, supplierLeads, suppliers } from "../db";
import { findSentTo, sendEmail } from "../mail/gmail";
import { getSettings } from "../settings";
import { COMPANY_PLACEHOLDER } from "./template";

export interface Recipient {
  leadId: string;
  supplierId: string;
  companyName: string;
  email: string;
  matchScore: number | null;
}

export interface CampaignStatus {
  /** Approved, has an address, and has not been written to yet. */
  pending: Recipient[];
  sent: number;
  failed: number;
  /** Approved but unreachable - no address, or never promoted to a supplier. */
  blocked: { companyName: string; reason: string }[];
}

/**
 * A supplier already carrying an outreach row for this project is off the list,
 * whatever its status. "queued" means a send started and its outcome was never
 * written back - a crash mid-flight. Treating that as "send again" is how a
 * factory receives the same RFQ twice, so it stays out until someone looks.
 */
export async function campaignStatus(projectId: string): Promise<CampaignStatus> {
  const [leads, existing] = await Promise.all([
    db
      .select()
      .from(supplierLeads)
      .where(
        and(eq(supplierLeads.projectId, projectId), eq(supplierLeads.status, "approved")),
      ),
    db.select().from(outreach).where(eq(outreach.projectId, projectId)),
  ]);

  const already = new Map(existing.map((row) => [row.supplierId, row.status]));

  const pending: Recipient[] = [];
  const blocked: CampaignStatus["blocked"] = [];

  for (const lead of leads) {
    if (!lead.email) {
      blocked.push({ companyName: lead.companyName, reason: "אין כתובת מייל" });
      continue;
    }
    if (!lead.supplierId) {
      blocked.push({ companyName: lead.companyName, reason: "לא הועבר למאגר הספקים" });
      continue;
    }
    const state = already.get(lead.supplierId);
    if (state === "queued") {
      blocked.push({ companyName: lead.companyName, reason: "שליחה קודמת נקטעה - בדוק בתיבה" });
      continue;
    }
    if (state) continue; // sent, failed, replied - not a fresh recipient

    pending.push({
      leadId: lead.id,
      supplierId: lead.supplierId,
      companyName: lead.companyName,
      email: lead.email,
      matchScore: lead.matchScore,
    });
  }

  pending.sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0));

  return {
    pending,
    sent: existing.filter((r) => r.status === "sent" || r.status === "replied").length,
    failed: existing.filter((r) => r.status === "failed").length,
    blocked,
  };
}

export interface PreparedCampaign {
  subject: string;
  /** Still carrying {{company}} - substituted per recipient at send time. */
  body: string;
  fromName: string;
  mailbox: string;
  attachment: { filename: string; mimeType: string; content: Buffer } | null;
}

/** Everything the send needs, resolved once and checked before anyone is mailed. */
export async function prepareCampaign(projectId: string): Promise<PreparedCampaign> {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) throw new Error("Project not found");
  if (!project.outreachSubject || !project.outreachBody) {
    throw new Error("אין מייל שמור לפרויקט - צריך לייצר אותו קודם");
  }

  const settings = await getSettings();
  if (!settings.senderName) throw new Error("חסר שם שולח בהגדרות");
  if (!settings.sourcingMailbox) throw new Error("חסרה תיבת שליחה בהגדרות");

  const [rfq] = await db
    .select()
    .from(files)
    .where(and(eq(files.projectId, projectId), eq(files.kind, "rfq")))
    .limit(1);

  return {
    subject: project.outreachSubject,
    body: project.outreachBody,
    fromName: `${settings.senderName} | ${settings.companyName}`,
    mailbox: settings.sourcingMailbox,
    attachment: rfq
      ? { filename: rfq.filename, mimeType: rfq.mimeType, content: rfq.content }
      : null,
  };
}

export interface SendOutcome {
  recipient: Recipient;
  ok: boolean;
  error?: string;
  remaining: number;
}

/**
 * Send to exactly one supplier and record it. Returns null when the list is
 * done, so the caller can stop without a separate emptiness check.
 */
export async function sendNext(
  projectId: string,
  prepared?: PreparedCampaign,
): Promise<SendOutcome | null> {
  const status = await campaignStatus(projectId);
  const recipient = status.pending[0];
  if (!recipient) return null;

  const campaign = prepared ?? (await prepareCampaign(projectId));
  const body = campaign.body.replaceAll(COMPANY_PLACEHOLDER, recipient.companyName);

  // Written before the message leaves, so a crash between the two leaves a
  // "queued" row that blocks a duplicate rather than an invisible send.
  const [row] = await db
    .insert(outreach)
    .values({
      projectId,
      supplierId: recipient.supplierId,
      subject: campaign.subject,
      body,
      status: "queued",
    })
    .returning({ id: outreach.id });

  if (!row) throw new Error("Could not record the outreach row");

  try {
    const result = await sendEmail({
      to: recipient.email,
      subject: campaign.subject,
      body,
      fromName: campaign.fromName,
      attachments: campaign.attachment ? [campaign.attachment] : [],
    });

    await db
      .update(outreach)
      .set({
        status: "sent",
        gmailMessageId: result.messageId,
        gmailThreadId: result.threadId,
        sentAt: new Date(),
      })
      .where(eq(outreach.id, row.id));

    // The outbound half of the conversation. The inbox monitor threads replies
    // onto this record, so it has to exist before any reply arrives.
    await db
      .insert(messages)
      .values({
        projectId,
        supplierId: recipient.supplierId,
        direction: "outbound",
        gmailMessageId: result.messageId,
        gmailThreadId: result.threadId,
        fromAddress: campaign.mailbox,
        subject: campaign.subject,
        bodyText: body,
        receivedAt: new Date(),
      })
      .onConflictDoNothing();

    await db
      .update(supplierLeads)
      .set({ status: "contacted" })
      .where(eq(supplierLeads.id, recipient.leadId));

    return { recipient, ok: true, remaining: status.pending.length - 1 };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(outreach)
      .set({ status: "failed", error: message })
      .where(eq(outreach.id, row.id));

    // The lead stays approved: a failure is worth retrying, unlike a send.
    return { recipient, ok: false, error: message, remaining: status.pending.length - 1 };
  }
}

export interface Reconciliation {
  company: string;
  outcome: "was-sent" | "never-sent";
}

/**
 * Resolve every "queued" row against the mailbox.
 *
 * A queued row means the send started and the outcome was never written back -
 * the browser closed mid-request, or the process died between the two writes.
 * Only the Sent folder knows which it was, so ask it: promote the ones that
 * went out, release the ones that did not. Guessing either way is how a factory
 * gets the same RFQ twice, or silently never gets it at all.
 */
export async function reconcileQueued(projectId: string): Promise<Reconciliation[]> {
  const stuck = await db
    .select({
      id: outreach.id,
      supplierId: outreach.supplierId,
      company: suppliers.companyName,
      email: suppliers.email,
      subject: outreach.subject,
      body: outreach.body,
    })
    .from(outreach)
    .innerJoin(suppliers, eq(outreach.supplierId, suppliers.id))
    .where(and(eq(outreach.projectId, projectId), eq(outreach.status, "queued")));

  const results: Reconciliation[] = [];

  for (const row of stuck) {
    if (!row.email) continue;
    const delivered = await findSentTo(row.email, row.subject);

    if (!delivered) {
      // Nothing left the building - drop the row so the supplier returns to
      // the pending list and the next run picks them up normally.
      await db.delete(outreach).where(eq(outreach.id, row.id));
      results.push({ company: row.company ?? row.email, outcome: "never-sent" });
      continue;
    }

    await db
      .update(outreach)
      .set({
        status: "sent",
        gmailMessageId: delivered.messageId,
        gmailThreadId: delivered.threadId,
        sentAt: delivered.sentAt,
      })
      .where(eq(outreach.id, row.id));

    await db
      .insert(messages)
      .values({
        projectId,
        supplierId: row.supplierId,
        direction: "outbound",
        gmailMessageId: delivered.messageId,
        gmailThreadId: delivered.threadId,
        subject: row.subject,
        bodyText: row.body,
        receivedAt: delivered.sentAt,
      })
      .onConflictDoNothing();

    await db
      .update(supplierLeads)
      .set({ status: "contacted" })
      .where(
        and(eq(supplierLeads.projectId, projectId), eq(supplierLeads.supplierId, row.supplierId)),
      );

    results.push({ company: row.company ?? row.email, outcome: "was-sent" });
  }

  return results;
}

/** Rows whose send failed, so the operator can see why before retrying. */
export async function failedSends(projectId: string) {
  return db
    .select({
      id: outreach.id,
      supplierId: outreach.supplierId,
      error: outreach.error,
      createdAt: outreach.createdAt,
    })
    .from(outreach)
    .where(and(eq(outreach.projectId, projectId), eq(outreach.status, "failed")))
    .orderBy(outreach.createdAt);
}

/** Clear a failed row so the supplier returns to the pending list. */
export async function clearFailed(projectId: string): Promise<number> {
  const removed = await db
    .delete(outreach)
    .where(
      and(
        eq(outreach.projectId, projectId),
        eq(outreach.status, "failed"),
        isNotNull(outreach.error),
      ),
    )
    .returning({ id: outreach.id });
  return removed.length;
}
