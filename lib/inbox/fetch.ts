/**
 * Read supplier replies off the threads we started.
 *
 * Every outbound message stored its Gmail threadId, so inbound mail needs no
 * guessing: a reply on thread X belongs to the supplier and project that thread
 * was created for. Matching on sender address instead would break the moment a
 * factory answers from a colleague's mailbox, which is normal - the person who
 * quotes is rarely the address printed on the contact page.
 */
import type { gmail_v1 } from "googleapis";
import { gmailClient } from "../mail/gmail";

export interface InboundAttachment {
  filename: string;
  mimeType: string;
  attachmentId: string;
  sizeBytes: number;
}

export interface InboundMessage {
  gmailMessageId: string;
  gmailThreadId: string;
  fromAddress: string;
  subject: string;
  bodyText: string;
  receivedAt: Date;
  attachments: InboundAttachment[];
}

function decodeBody(data: string): string {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(Number(c)))
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Walk the MIME tree, preferring text/plain and falling back to stripped HTML. */
function extractContent(payload: gmail_v1.Schema$MessagePart | undefined): {
  text: string;
  attachments: InboundAttachment[];
} {
  const attachments: InboundAttachment[] = [];
  let plain = "";
  let html = "";

  const walk = (part: gmail_v1.Schema$MessagePart | undefined) => {
    if (!part) return;

    const filename = part.filename ?? "";
    const attachmentId = part.body?.attachmentId;

    if (filename && attachmentId) {
      attachments.push({
        filename,
        mimeType: part.mimeType ?? "application/octet-stream",
        attachmentId,
        sizeBytes: part.body?.size ?? 0,
      });
    } else if (part.body?.data) {
      const decoded = decodeBody(part.body.data);
      if (part.mimeType === "text/plain") plain += `${decoded}\n`;
      else if (part.mimeType === "text/html") html += `${decoded}\n`;
    }

    for (const child of part.parts ?? []) walk(child);
  };

  walk(payload);
  return { text: (plain.trim() || stripHtml(html)).trim(), attachments };
}

/**
 * Quoted history repeats our own RFQ back at us on every reply. Left in, the
 * classifier reads the requirements we wrote and calls it a quotation.
 */
export function stripQuotedHistory(body: string): string {
  const lines = body.split(/\r?\n/);
  const out: string[] = [];

  for (const line of lines) {
    if (/^\s*(On .+wrote:|-{2,}\s*Original Message|_{5,}|From:\s|发件人:)/i.test(line)) break;
    if (/^\s*>/.test(line)) continue;
    out.push(line);
  }

  const trimmed = out.join("\n").trim();
  // A reply that is nothing but quoted text still needs its content kept.
  return trimmed.length > 20 ? trimmed : body.trim();
}

function headerOf(message: gmail_v1.Schema$Message, name: string): string {
  return message.payload?.headers?.find((h) => h.name?.toLowerCase() === name)?.value ?? "";
}

/** Every message on the thread that did not come from us. */
export async function inboundOnThread(
  threadId: string,
  ourMailbox: string,
): Promise<InboundMessage[]> {
  const gmail = gmailClient();
  const thread = await gmail.users.threads.get({ userId: "me", id: threadId, format: "full" });

  const inbound: InboundMessage[] = [];

  for (const message of thread.data.messages ?? []) {
    const from = headerOf(message, "from");
    if (from.toLowerCase().includes(ourMailbox.toLowerCase())) continue;

    const { text, attachments } = extractContent(message.payload);

    inbound.push({
      gmailMessageId: message.id as string,
      gmailThreadId: message.threadId as string,
      fromAddress: from,
      subject: headerOf(message, "subject"),
      bodyText: stripQuotedHistory(text),
      receivedAt: new Date(Number(message.internalDate ?? Date.now())),
      attachments,
    });
  }

  return inbound;
}

/** Pull the bytes of one attachment. */
export async function downloadAttachment(
  messageId: string,
  attachmentId: string,
): Promise<Buffer> {
  const gmail = gmailClient();
  const attachment = await gmail.users.messages.attachments.get({
    userId: "me",
    messageId,
    id: attachmentId,
  });

  const data = attachment.data.data ?? "";
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}
