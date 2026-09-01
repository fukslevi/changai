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
import { and, desc, eq } from "drizzle-orm";
import { db, files, messages, quoteReadings } from "../db";
import sharp from "sharp";
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

/**
 * Vision input is billed by pixel area, not by information, so a 6MB phone
 * photo of a price list costs many times what the same price list costs at a
 * size you can still read. 102 images had gone to the model at whatever
 * resolution the supplier's camera happened to use, 35.9MB of them.
 *
 * 1280px on the long edge keeps a quotation, a label and a spec sheet legible
 * while capping what any one image can cost. Failures return the original -
 * an image that reaches the model expensively still beats one that does not
 * reach it at all.
 */
/**
 * Compliance certificates, described rather than sent.
 *
 * Measured on the real mailbox: 241 PDF pages arrived from suppliers, and the
 * three largest documents were a 57-page CE-EMC report, a 26-page CE-LVD report
 * and a 24-page SGS assessment. Together with one more certificate they are 108
 * pages - 45% of everything - and not one of them contains a price, an MOQ or a
 * lead time. What the extractor produced from SINOCO's 83 pages of test reports,
 * in full, was: "CE (EMC EN55015/EN61547, LVD EN60598)". One line, derivable
 * from the filenames.
 *
 * Two guards against skipping something that matters. The name has to look like
 * a certificate, and the document has to be long enough that sending it costs
 * something - a one-page certificate is cheap, and a supplier who names their
 * quotation "CE price list.pdf" keeps it. When the page count cannot be read the
 * document is sent: unknown is not the same as large, and the failure that
 * matters here is a quotation we never opened.
 */
const CERTIFICATE_NAME =
  /\b(ce[-_ ]?(emc|lvd|doc)|emc|lvd|sgs|rohs|reach|iso\s*\d|bsci|fcc|prop\s*65|cpsia|certificat|zertifikat|test\s*report|inspection\s*report)\b/i;

/** Below this a certificate is not worth the machinery - just send it. */
const CERTIFICATE_MIN_PAGES = 4;

/**
 * Page count straight from the PDF's own object table.
 *
 * A heuristic, and deliberately a conservative one: on a PDF whose page tree is
 * inside a compressed object stream it finds nothing and returns 0, which reads
 * as "do not skip". Good enough to decide whether a document is long; not good
 * enough to bill on, and nothing here bills on it.
 */
function pdfPageCount(data: Buffer): number {
  const matches = data.toString("latin1").match(/\/Type\s*\/Page[^s]/g);
  return matches ? matches.length : 0;
}

const MAX_IMAGE_EDGE = 1280;

async function downscale(
  data: Buffer,
  mediaType: ImageMediaType,
): Promise<{ data: Buffer; mediaType: ImageMediaType }> {
  try {
    const image = sharp(data, { failOn: "none" });
    const meta = await image.metadata();
    const longest = Math.max(meta.width ?? 0, meta.height ?? 0);
    if (longest === 0 || longest <= MAX_IMAGE_EDGE) return { data, mediaType };

    /*
     * Re-encoded as JPEG whatever it arrived as. A resized PNG of a photograph
     * stays large for no benefit, and nothing here depends on transparency -
     * these are pictures of documents and products.
     */
    const resized = await image
      .rotate()
      .resize({ width: MAX_IMAGE_EDGE, height: MAX_IMAGE_EDGE, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();

    return resized.length < data.length
      ? { data: resized, mediaType: "image/jpeg" }
      : { data, mediaType };
  } catch {
    return { data, mediaType };
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
        const raw = Buffer.from(parsed.base64, "base64");
        const pages = pdfPageCount(raw);

        if (CERTIFICATE_NAME.test(stored.filename) && pages >= CERTIFICATE_MIN_PAGES) {
          blocks.push({
            type: "text",
            text:
              `(${stored.filename}: a ${pages}-page compliance certificate, not sent in full. ` +
              `Record that this certificate exists and what it covers, from its name. ` +
              `Certificates carry no price, MOQ or lead time.)`,
          });
          continue;
        }

        blocks.push({
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: parsed.base64 },
          title: stored.filename,
        });
        spent += parsed.base64.length;
      } else {
        const media = imageType(parsed.mediaType);
        if (media && parsed.base64.length <= MAX_IMAGE_BASE64) {
          const shrunk = await downscale(Buffer.from(parsed.base64, "base64"), media);
          const encoded = shrunk.data.toString("base64");
          blocks.push({
            type: "image",
            source: { type: "base64", media_type: shrunk.mediaType, data: encoded },
          });
          spent += encoded.length;
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

/**
 * What the attachments SAID, instead of the attachments themselves.
 *
 * The binaries were being sent three times for one supplier reply: once to
 * extract the quotation, once to plan the answer, once to draft it. Measured
 * across the mailbox that is 20 PDFs (241 pages) and 102 images, 81.6MB, and
 * the two later calls were re-reading pages the first call had already turned
 * into numbers. Over 95% of the model's input was catalogues and photos; the
 * text a supplier actually typed came to 25k tokens in total.
 *
 * The extraction is the only call that needs to look at a page. Once it has
 * run, its reading is a better input for planning and drafting than the file
 * ever was - it is the same information with the ambiguity already resolved.
 *
 * If no reading exists - extraction has not run yet, or it failed - this falls
 * back to the binaries, because a planner that cannot see the quotation tells
 * suppliers we never received it. Cheaper is not worth that.
 */
export async function attachmentSummary(
  projectId: string,
  supplierId: string,
  attachments: { filename: string; mimeType: string; storagePath: string }[],
): Promise<AttachmentBlock[]> {
  if (attachments.length === 0) return [];

  const [reading] = await db
    .select()
    .from(quoteReadings)
    .where(
      and(eq(quoteReadings.projectId, projectId), eq(quoteReadings.supplierId, supplierId)),
    )
    .orderBy(desc(quoteReadings.createdAt))
    .limit(1);

  if (!reading) return attachmentBlocks(attachments);

  const money = (v: string | null) => (v === null ? null : `${reading.currency} ${v}`);
  const lines: string[] = [
    `WHAT THEY ATTACHED: ${attachments.map((a) => a.filename).join(", ")}`,
    "",
    "ALREADY READ OUT OF THOSE FILES - treat this as what the documents say:",
  ];

  for (const line of reading.lines) {
    const price = line.unit_price === null ? "no price" : `${reading.currency} ${line.unit_price}`;
    const qty = line.qty === null ? "" : ` at ${line.qty}`;
    const note = line.spec_note ? ` - ${line.spec_note}` : "";
    lines.push(`  - ${line.item_name}${qty}: ${price}${note}`);
  }
  if (reading.lines.length === 0) lines.push("  (no priced lines in the documents)");

  const facts: [string, unknown][] = [
    ["incoterm", [reading.incoterm, reading.incotermPlace].filter(Boolean).join(" ") || null],
    ["MOQ", reading.moq],
    ["lead time (days)", reading.leadTimeDays],
    ["payment terms", reading.paymentTerms],
    ["sample price", money(reading.samplePrice ?? null)],
    ["sample lead time (days)", reading.sampleLeadTimeDays],
    ["tooling", money(reading.toolingCost ?? null)],
    ["certificates", reading.certificates.join(", ") || null],
    ["units per carton", reading.unitsPerCarton],
    ["carton", reading.cartonDimensionsCm],
    ["carton gross weight (kg)", reading.cartonGrossWeightKg],
  ];
  const known = facts.filter(([, v]) => v !== null && v !== undefined && v !== "");
  if (known.length > 0) {
    lines.push("", "TERMS FROM THE DOCUMENTS:");
    for (const [label, value] of known) lines.push(`  ${label}: ${value}`);
  }

  if (reading.deviations.length > 0) {
    lines.push("", "WHERE THEIR OFFER DIFFERS FROM THE RFQ:");
    for (const d of reading.deviations) {
      lines.push(
        `  - we asked ${d.our_requirement}; they offer ${d.what_they_offer}${d.their_reason ? ` (${d.their_reason})` : ""}`,
      );
    }
  }

  if (reading.rejectsTargetPrice) {
    lines.push("", `THEY PUSHED BACK ON THE TARGET PRICE: ${reading.priceObjection ?? "(no reason given)"}`);
  }

  return [{ type: "text", text: lines.join("\n") }];
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
