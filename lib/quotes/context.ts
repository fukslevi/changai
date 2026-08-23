/**
 * The contents of what a supplier attached, in the form the model can read.
 *
 * Spreadsheets become text. PDFs and images do not: the model reads those
 * natively as document and image blocks, and the earlier version of this file
 * only ever returned strings - so a PDF came through as "binary; not readable
 * as text", the planner believed it, and we told a supplier we could not open
 * the quotation she had just sent. The capability was there; nothing carried it
 * to the model.
 */
import { eq } from "drizzle-orm";
import { db, files, messages } from "../db";
import { readAttachment } from "./read";

/** Per file, so one unreadable attachment does not crowd out the others. */
const PER_FILE_CHARS = 8000;

/**
 * Both caps are measured on the base64 payload, not on the file.
 *
 * This is the whole of the bug that got through the first fix. The limit was
 * read as ten megabytes of image and applied to the file on disk, but what the
 * API weighs is the encoded string in the request - a third larger. A 7.9MB
 * photo passed a check written against 10MB of file and arrived as 10.5MB of
 * base64, and the rejection took down the project's entire cycle, not just the
 * one attachment.
 *
 * Comparing the encoded length removes the arithmetic: it is the same number
 * the API is going to measure.
 */
const MAX_DOCUMENT_BASE64 = 30 * 1024 * 1024;
const MAX_IMAGE_BASE64 = 10 * 1024 * 1024;

/**
 * And a budget across the whole message, not just per file.
 *
 * One supplier sent four photos of 6-8MB each. Every one of them is under the
 * per-image cap and together they are 25MB of base64 in a request the API caps
 * at 32MB - so a set of individually legal attachments fails as a group. The
 * later ones are described instead; a quotation that needs the fifth photo to
 * be legible is rare, and a cycle that dies is not.
 */
const MAX_TOTAL_BASE64 = 18 * 1024 * 1024;

/** A content block for the messages API, or a line of text for the brief. */
export type ImageMediaType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

export type AttachmentBlock =
  | { type: "text"; text: string }
  | {
      type: "document";
      source: { type: "base64"; media_type: "application/pdf"; data: string };
      title: string;
    }
  | { type: "image"; source: { type: "base64"; media_type: ImageMediaType; data: string } };

/** The API accepts four image types; anything else is described, not sent. */
function imageType(mediaType: string | undefined): ImageMediaType | null {
  switch (mediaType) {
    case "image/png":
    case "image/jpeg":
    case "image/gif":
    case "image/webp":
      return mediaType;
    case "image/jpg":
      return "image/jpeg";
    default:
      return null;
  }
}

export async function attachmentBlocks(
  attachments: { filename: string; mimeType: string; storagePath: string }[],
): Promise<AttachmentBlock[]> {
  const blocks: AttachmentBlock[] = [];
  let spent = 0;

  for (const attachment of attachments) {
    const [stored] = await db.select().from(files).where(eq(files.id, attachment.storagePath));
    if (!stored) continue;

    const parsed = readAttachment(stored.filename, stored.mimeType, stored.content);

    if (parsed.text) {
      blocks.push({
        type: "text",
        text: `--- ${stored.filename} ---\n${parsed.text.slice(0, PER_FILE_CHARS)}`,
      });
      continue;
    }

    if (parsed.base64 && spent + parsed.base64.length > MAX_TOTAL_BASE64) {
      blocks.push({
        type: "text",
        text: `--- ${stored.filename} --- (not sent: the message already carries ${(spent / 1024 / 1024).toFixed(0)}MB of attachments)`,
      });
      continue;
    }

    if (parsed.base64 && parsed.base64.length <= MAX_DOCUMENT_BASE64) {
      blocks.push({ type: "text", text: `--- ${stored.filename} ---` });
      if (parsed.kind === "pdf") {
        blocks.push({
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: parsed.base64 },
          title: stored.filename,
        });
        spent += parsed.base64.length;
      } else {
        const media = imageType(parsed.mediaType);
        if (media && parsed.base64.length <= MAX_IMAGE_BASE64) {
          blocks.push({
            type: "image",
            source: { type: "base64", media_type: media, data: parsed.base64 },
          });
          spent += parsed.base64.length;
        } else if (media) {
          blocks.push({
            type: "text",
            text: `(${stored.filename}: image too large to read, ${(stored.content.length / 1024 / 1024).toFixed(1)}MB)`,
          });
        } else {
          blocks.push({
            type: "text",
            text: `(${stored.filename}: unsupported image type ${parsed.mediaType})`,
          });
        }
      }
      continue;
    }

    blocks.push({
      type: "text",
      text: `--- ${stored.filename} --- (${parsed.note ?? "could not be read"})`,
    });
  }

  return blocks;
}

/** The attachments on the most recent inbound message of a thread. */
export async function latestInboundAttachments(
  projectId: string,
  supplierId: string,
): Promise<AttachmentBlock[]> {
  const thread = await db.select().from(messages).where(eq(messages.projectId, projectId));

  const latest = thread
    .filter((m) => m.supplierId === supplierId && m.direction === "inbound")
    .sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime())[0];

  if (!latest) return [];
  return attachmentBlocks(latest.attachments);
}
