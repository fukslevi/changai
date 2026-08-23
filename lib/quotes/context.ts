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

/** Anthropic caps a document at 32MB; a quote deck is far below that. */
const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

/**
 * Images have their own, lower cap - 10MB - and exceeding it is rejected by the
 * API rather than truncated. A supplier's 10.5MB photo took down the whole
 * project's cycle, so oversize images are described instead of sent.
 */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

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

    if (parsed.base64 && stored.content.length <= MAX_DOCUMENT_BYTES) {
      blocks.push({ type: "text", text: `--- ${stored.filename} ---` });
      if (parsed.kind === "pdf") {
        blocks.push({
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: parsed.base64 },
          title: stored.filename,
        });
      } else {
        const media = imageType(parsed.mediaType);
        if (media && stored.content.length <= MAX_IMAGE_BYTES) {
          blocks.push({
            type: "image",
            source: { type: "base64", media_type: media, data: parsed.base64 },
          });
        } else if (media) {
          blocks.push({
            type: "text",
            text: `(${stored.filename}: image too large to read, ${Math.round(stored.content.length / 1024 / 1024)}MB)`,
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
