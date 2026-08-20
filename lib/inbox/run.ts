/**
 * Poll the threads we started, store what came back, and triage it.
 *
 * Runs over stored threadIds rather than over the whole mailbox, so nothing
 * unrelated in the sourcing inbox is ever read, and a reply cannot be attached
 * to the wrong project.
 */
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  files,
  messages,
  outreach,
  projects,
  quoteReadings,
  requirements,
  supplierLeads,
  suppliers,
} from "../db";
import { getSettings } from "../settings";
import { triageAndPark } from "./autopilot";
import { analyseReply } from "./classify";
import { findStrayReplies } from "./sweep";
import { attachmentBlocks } from "../quotes/context";
import { extractQuote } from "../quotes/extract";
import { downloadAttachment, inboundOnThread } from "./fetch";

export interface InboxResult {
  threadsChecked: number;
  newMessages: number;
  classified: number;
  needsHuman: number;
  /** Questions raised that only a person can answer. */
  parked: number;
  /** Replies whose numbers were recorded, refusals included. */
  quotesRead: number;
  errors: string[];
}

/** Gmail counts a size limit per attachment; a quote deck above this is unusual. */
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

export async function pollInbox(projectId: string): Promise<InboxResult> {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) throw new Error("Project not found");

  const settings = await getSettings();
  const mailbox = settings.sourcingMailbox;
  if (!mailbox) throw new Error("חסרה תיבת שליחה בהגדרות");

  const threads = await db
    .select({
      threadId: outreach.gmailThreadId,
      supplierId: outreach.supplierId,
      outreachId: outreach.id,
    })
    .from(outreach)
    /*
     * Both states, not just "sent".
     *
     * A thread flips to "replied" the first time a supplier answers - and the
     * poll used to skip those, so every message after the first was invisible.
     * Four suppliers had written back several times each and the system had
     * read none of it. A conversation does not stop being worth reading because
     * it has already been read once.
     */
    .where(
      and(
        eq(outreach.projectId, projectId),
        inArray(outreach.status, ["sent", "replied"]),
      ),
    );

  /*
   * Threads a supplier started on their own side. Adding them to the same walk
   * means everything downstream - attachments, triage, replies - works exactly
   * as it does for a thread we opened, rather than needing a second path.
   */
  const knownIdsForSweep = await db
    .select({ id: messages.gmailMessageId })
    .from(messages)
    .where(eq(messages.projectId, projectId));

  const strays = await findStrayReplies(
    projectId,
    mailbox,
    new Set(knownIdsForSweep.map((m) => m.id)),
  );

  const known = await db
    .select({ id: messages.gmailMessageId })
    .from(messages)
    .where(eq(messages.projectId, projectId));
  const seen = new Set(known.map((m) => m.id));

  const projectRequirements = await db
    .select({ text: requirements.text })
    .from(requirements)
    .where(eq(requirements.projectId, projectId));
  const requirementTexts = projectRequirements.map((r) => r.text);

  const strayThreads = new Map<string, { threadId: string; supplierId: string }>();
  for (const stray of strays) {
    if (threads.some((t) => t.threadId === stray.gmailThreadId)) continue;
    strayThreads.set(stray.gmailThreadId, {
      threadId: stray.gmailThreadId,
      supplierId: stray.supplierId,
    });
  }

  const result: InboxResult = {
    threadsChecked: 0,
    newMessages: 0,
    classified: 0,
    needsHuman: 0,
    parked: 0,
    quotesRead: 0,
    errors: [],
  };

  const walk: { threadId: string | null; supplierId: string; outreachId: string | null }[] = [
    ...threads.map((t) => ({
      threadId: t.threadId,
      supplierId: t.supplierId,
      outreachId: t.outreachId as string | null,
    })),
    ...[...strayThreads.values()].map((t) => ({
      threadId: t.threadId,
      supplierId: t.supplierId,
      outreachId: null,
    })),
  ];

  for (const thread of walk) {
    if (!thread.threadId) continue;
    result.threadsChecked++;

    let inbound;
    try {
      inbound = await inboundOnThread(thread.threadId, mailbox);
    } catch (err) {
      result.errors.push(
        `thread ${thread.threadId}: ${err instanceof Error ? err.message : err}`,
      );
      continue;
    }

    for (const message of inbound) {
      if (seen.has(message.gmailMessageId)) continue;
      result.newMessages++;

      // Attachments land in `files` as their own rows so the quote parser has
      // real bytes to read, not a reference to a mailbox that may change.
      const stored: { filename: string; mimeType: string; storagePath: string }[] = [];
      for (const attachment of message.attachments) {
        if (attachment.sizeBytes > MAX_ATTACHMENT_BYTES) {
          result.errors.push(`${attachment.filename} too large to store`);
          continue;
        }
        try {
          const content = await downloadAttachment(
            message.gmailMessageId,
            attachment.attachmentId,
          );
          const [file] = await db
            .insert(files)
            .values({
              projectId,
              filename: attachment.filename,
              mimeType: attachment.mimeType,
              sizeBytes: content.length,
              content,
              kind: "quote",
            })
            .returning({ id: files.id });

          if (file) {
            stored.push({
              filename: attachment.filename,
              mimeType: attachment.mimeType,
              storagePath: file.id,
            });
          }
        } catch (err) {
          result.errors.push(
            `${attachment.filename}: ${err instanceof Error ? err.message : err}`,
          );
        }
      }

      let analysis = null;
      let classification: string = "unclassified";
      try {
        const triage = await analyseReply(project.name, requirementTexts, {
          fromAddress: message.fromAddress,
          subject: message.subject,
          bodyText: message.bodyText,
          attachments: message.attachments.map((a) => a.filename),
        });
        analysis = triage.analysis;
        classification = triage.analysis.classification;
        result.classified++;
        if (triage.analysis.needs_human) result.needsHuman++;
      } catch (err) {
        result.errors.push(
          `classify ${message.gmailMessageId}: ${err instanceof Error ? err.message : err}`,
        );
      }

      await db
        .insert(messages)
        .values({
          projectId,
          supplierId: thread.supplierId,
          direction: "inbound",
          gmailMessageId: message.gmailMessageId,
          gmailThreadId: message.gmailThreadId,
          fromAddress: message.fromAddress,
          subject: message.subject,
          bodyText: message.bodyText,
          attachments: stored,
          classification: classification as never,
          analysis: analysis
            ? {
                summary_he: analysis.summary_he,
                questions_from_supplier: analysis.questions_from_supplier,
                answered: analysis.answered,
                missing: analysis.missing,
                challenges_a_requirement: analysis.challenges_a_requirement,
                challenge_detail: analysis.challenge_detail,
                needs_human: analysis.needs_human,
                needs_human_reason: analysis.needs_human_reason,
              }
            : null,
          receivedAt: message.receivedAt,
        })
        .onConflictDoNothing();

      seen.add(message.gmailMessageId);

      /*
       * Read the numbers, whatever the classification says. A refusal carries
       * pricing surprisingly often - "not even at double" is a data point about
       * the floor - and a reply parked for a person still deserves to appear in
       * the comparison rather than waiting for someone to open it.
       */
      if (classification !== "not_relevant") {
        try {
          const blocks = await attachmentBlocks(stored);
          const { quote } = await extractQuote(
            project.name,
            requirementTexts,
            {
              fromAddress: message.fromAddress,
              subject: message.subject,
              bodyText: message.bodyText,
            },
            blocks as never,
          );

          if (quote.has_pricing || quote.rejects_target_price || quote.deviations.length > 0) {
            const [row] = await db
              .select({ id: messages.id })
              .from(messages)
              .where(eq(messages.gmailMessageId, message.gmailMessageId))
              .limit(1);

            await db.insert(quoteReadings).values({
              projectId,
              supplierId: thread.supplierId,
              messageId: row?.id ?? null,
              currency: quote.currency,
              incoterm: quote.incoterm,
              incotermPlace: quote.incoterm_place,
              lines: quote.lines,
              moq: quote.moq,
              leadTimeDays: quote.lead_time_days,
              paymentTerms: quote.payment_terms,
              samplePrice: quote.sample_price === null ? null : String(quote.sample_price),
              sampleLeadTimeDays: quote.sample_lead_time_days,
              toolingCost: quote.tooling_cost === null ? null : String(quote.tooling_cost),
              certificates: quote.certificates,
              unitsPerCarton: quote.units_per_carton,
              cartonDimensionsCm: quote.carton_dimensions_cm,
              cartonGrossWeightKg:
                quote.carton_gross_weight_kg === null ? null : String(quote.carton_gross_weight_kg),
              deviations: quote.deviations,
              rejectsTargetPrice: quote.rejects_target_price,
              priceObjection: quote.price_objection,
              summaryHe: quote.summary_he,
            });
            result.quotesRead++;
          }
        } catch (err) {
          result.errors.push(
            `quote ${message.gmailMessageId}: ${err instanceof Error ? err.message : err}`,
          );
        }
      }

      // An auto-reply is not a reply. Marking the thread "replied" on an out of
      // office would take the supplier off the follow-up list for nothing.
      if (classification !== "not_relevant") {
        if (thread.outreachId) {
          await db
            .update(outreach)
            .set({ status: "replied" })
            .where(eq(outreach.id, thread.outreachId));
        }

        await db
          .update(supplierLeads)
          .set({ status: "contacted" })
          .where(
            and(
              eq(supplierLeads.projectId, projectId),
              eq(supplierLeads.supplierId, thread.supplierId),
            ),
          );
      }
    }
  }

  /*
   * Work out what still needs a human, now, rather than the next time someone
   * opens the page. A thread that is quietly waiting on an unasked question is
   * indistinguishable from a supplier who never replied.
   */
  if (result.newMessages > 0) {
    try {
      const triage = await triageAndPark(projectId);
      result.parked = triage.parked.reduce((n, p) => n + p.questions.length, 0);
    } catch (err) {
      result.errors.push(`triage: ${err instanceof Error ? err.message : err}`);
    }
  }

  return result;
}

/** Everything that came back, newest first, with the supplier attached. */
export async function conversations(projectId: string) {
  const rows = await db
    .select({
      id: messages.id,
      supplierId: messages.supplierId,
      company: suppliers.companyName,
      supplierEmail: suppliers.email,
      website: suppliers.website,
      direction: messages.direction,
      threadId: messages.gmailThreadId,
      subject: messages.subject,
      bodyText: messages.bodyText,
      attachments: messages.attachments,
      classification: messages.classification,
      analysis: messages.analysis,
      handledAt: messages.handledAt,
      receivedAt: messages.receivedAt,
    })
    .from(messages)
    .leftJoin(suppliers, eq(messages.supplierId, suppliers.id))
    .where(eq(messages.projectId, projectId))
    .orderBy(messages.receivedAt);

  return rows;
}
