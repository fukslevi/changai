import { randomUUID } from "node:crypto";
import { google, type gmail_v1 } from "googleapis";

/**
 * Gmail send/read client backed by the refresh token from scripts/gmail-auth.ts.
 *
 * The API is used rather than SMTP so that every message keeps its Gmail
 * threadId — that identifier is what lets an inbound reply be matched back to
 * the supplier and project that produced it.
 */

export interface Attachment {
  filename: string;
  mimeType: string;
  content: Buffer;
}

export interface SendOptions {
  to: string;
  subject: string;
  /** Plain text. Suppliers read these on phones; HTML buys nothing here. */
  body: string;
  fromName?: string;
  attachments?: Attachment[];
  /** Set to keep a reply in the original conversation. */
  threadId?: string;
  /**
   * The Message-ID being answered. Gmail threads on its own threadId, but every
   * other mail client threads on these headers - and the supplier is not
   * necessarily on Gmail. Without them a reply arrives as a new conversation on
   * their side and the context is lost.
   */
  inReplyTo?: string;
  references?: string;
}

export interface SendResult {
  messageId: string;
  threadId: string;
}

export function gmailClient(): gmail_v1.Gmail {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
    throw new Error(
      "Gmail is not connected - run: npx tsx --env-file=.env scripts/gmail-auth.ts",
    );
  }

  const auth = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
  auth.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
  return google.gmail({ version: "v1", auth });
}

/**
 * Strip anything that could end the header block or begin a new header.
 *
 * A supplier's subject reached this untouched once replies began following
 * theirs, and one of them ended in a newline: "TO: Shlomi Saadi\n". In a raw
 * MIME message a bare newline terminates the headers, so everything after it -
 * MIME-Version, In-Reply-To, Content-Type and the base64 body - was delivered
 * as visible text. Zoey received the envelope instead of the letter.
 *
 * It is also the injection. The subject and the address we reply to are both
 * written by the person we are answering, and a subject ending in
 * "\nBcc: someone@example.com" would have added a real header to our mail.
 * That this arrived as a stray newline rather than a crafted one is luck.
 *
 * Every header value goes through it, not only the ones known to come from
 * outside, because "known to come from outside" is the assumption that failed.
 */
export function sanitiseHeader(value: string): string {
  return value.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
}

/** RFC 2047 for headers that contain anything outside ASCII. */
function encodeHeader(value: string): string {
  const clean = sanitiseHeader(value);
  // eslint-disable-next-line no-control-regex
  return /^[\x00-\x7F]*$/.test(clean)
    ? clean
    : `=?UTF-8?B?${Buffer.from(clean, "utf8").toString("base64")}?=`;
}

function wrap76(base64: string): string {
  return base64.replace(/(.{76})/g, "$1\r\n");
}

function buildRawMessage(from: string, options: SendOptions): string {
  const headers = [
    `From: ${sanitiseHeader(from)}`,
    `To: ${sanitiseHeader(options.to)}`,
    `Subject: ${encodeHeader(options.subject)}`,
    "MIME-Version: 1.0",
  ];

  if (options.inReplyTo) headers.push(`In-Reply-To: ${sanitiseHeader(options.inReplyTo)}`);
  if (options.references) headers.push(`References: ${sanitiseHeader(options.references)}`);

  const attachments = options.attachments ?? [];

  if (attachments.length === 0) {
    return [
      ...headers,
      'Content-Type: text/plain; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      wrap76(Buffer.from(options.body, "utf8").toString("base64")),
    ].join("\r\n");
  }

  const boundary = `b_${randomUUID().replace(/-/g, "")}`;
  const parts = [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(Buffer.from(options.body, "utf8").toString("base64")),
  ];

  for (const file of attachments) {
    parts.push(
      `--${boundary}`,
      `Content-Type: ${file.mimeType}; name="${file.filename}"`,
      `Content-Disposition: attachment; filename="${file.filename}"`,
      "Content-Transfer-Encoding: base64",
      "",
      wrap76(file.content.toString("base64")),
    );
  }

  parts.push(`--${boundary}--`, "");
  return parts.join("\r\n");
}

export async function sendEmail(options: SendOptions): Promise<SendResult> {
  const mailbox = process.env.SOURCING_MAILBOX;
  if (!mailbox) throw new Error("SOURCING_MAILBOX is not set");

  const from = options.fromName
    ? `${encodeHeader(options.fromName)} <${sanitiseHeader(mailbox)}>`
    : sanitiseHeader(mailbox);

  const raw = Buffer.from(buildRawMessage(from, options), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const response = await gmailClient().users.messages.send({
    userId: "me",
    requestBody: { raw, ...(options.threadId ? { threadId: options.threadId } : {}) },
  });

  const { id, threadId } = response.data;
  if (!id || !threadId) throw new Error("Gmail accepted the message but returned no id");
  return { messageId: id, threadId };
}

/** The RFC Message-ID of a stored message, for threading a reply onto it. */
export async function messageIdHeaderOf(gmailMessageId: string): Promise<string | null> {
  const message = await gmailClient().users.messages.get({
    userId: "me",
    id: gmailMessageId,
    format: "metadata",
    metadataHeaders: ["Message-ID"],
  });

  return (
    message.data.payload?.headers?.find((h) => h.name?.toLowerCase() === "message-id")?.value ??
    null
  );
}

/**
 * Look in Sent for a message to this address with this subject.
 *
 * The authority on whether an outbound message actually left, for when the
 * local record was never written back.
 */
export async function findSentTo(
  to: string,
  subject: string,
): Promise<{ messageId: string; threadId: string; sentAt: Date } | null> {
  const gmail = gmailClient();
  const list = await gmail.users.messages.list({
    userId: "me",
    q: `in:sent to:${to}`,
    maxResults: 20,
  });

  for (const item of list.data.messages ?? []) {
    if (!item.id) continue;
    const message = await gmail.users.messages.get({
      userId: "me",
      id: item.id,
      format: "metadata",
      metadataHeaders: ["Subject"],
    });

    const found = message.data.payload?.headers?.find((h) => h.name === "Subject")?.value;
    if (found !== subject) continue;

    return {
      messageId: message.data.id as string,
      threadId: message.data.threadId as string,
      sentAt: new Date(Number(message.data.internalDate ?? Date.now())),
    };
  }

  return null;
}

/** Confirms the token still works and reports which mailbox it belongs to. */
export async function verifyGmailConnection(): Promise<{
  email: string;
  messagesTotal: number;
}> {
  const profile = await gmailClient().users.getProfile({ userId: "me" });
  return {
    email: profile.data.emailAddress ?? "",
    messagesTotal: profile.data.messagesTotal ?? 0,
  };
}
