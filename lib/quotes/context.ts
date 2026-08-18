/**
 * The contents of what a supplier attached, as text for the model.
 *
 * Shared by both writers - the autopilot planner and the manual drafter -
 * because they had drifted apart: one could read a quotation and the other told
 * the supplier we had never received it. Anything a person would open before
 * replying has to be in front of whichever code path writes the reply.
 */
import { eq } from "drizzle-orm";
import { db, files, messages } from "../db";
import { readAttachment } from "./read";

/** Per file, so one unreadable attachment does not hide the others. */
const PER_FILE_CHARS = 8000;

export async function attachmentContext(
  attachments: { filename: string; mimeType: string; storagePath: string }[],
): Promise<string[]> {
  const out: string[] = [];

  for (const attachment of attachments) {
    const [stored] = await db.select().from(files).where(eq(files.id, attachment.storagePath));
    if (!stored) continue;

    const parsed = readAttachment(stored.filename, stored.mimeType, stored.content);
    out.push(
      parsed.text
        ? `--- ${stored.filename} ---\n${parsed.text.slice(0, PER_FILE_CHARS)}`
        : `--- ${stored.filename} --- (${parsed.note ?? "binary; not readable as text"})`,
    );
  }

  return out;
}

/** The attachments on the most recent inbound message of a thread. */
export async function latestInboundAttachments(
  projectId: string,
  supplierId: string,
): Promise<string[]> {
  const thread = await db.select().from(messages).where(eq(messages.projectId, projectId));

  const latest = thread
    .filter((m) => m.supplierId === supplierId && m.direction === "inbound")
    .sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime())[0];

  if (!latest) return [];
  return attachmentContext(latest.attachments);
}
