/**
 * Turn a supplier's attachment into text a model can read.
 *
 * Quotes arrive as whatever the sales person had open: an Excel sheet, a PDF, a
 * photo of a printout. The numbers that matter - price per tier, MOQ, carton
 * size - are the same in all of them, so the job here is only to get the
 * content into a form the extractor can work with, and to be honest when a file
 * cannot be read rather than returning an empty string that looks like an empty
 * quote.
 */
import * as XLSX from "xlsx";

export type ReadableKind = "text" | "pdf" | "image" | "unsupported";

export interface ReadableFile {
  kind: ReadableKind;
  /** Populated for spreadsheets and plain text. */
  text?: string;
  /** Populated for PDFs and images, which the model reads directly. */
  base64?: string;
  mediaType?: string;
  note?: string;
}

/**
 * Every sheet as CSV, with the sheet name above it.
 *
 * A supplier's workbook routinely carries the quote on one tab and the packing
 * details on another, and dropping the extra tabs is how carton dimensions go
 * missing - which is the number the landed cost depends on most.
 */
function spreadsheetToText(content: Buffer): string {
  const workbook = XLSX.read(content, { type: "buffer" });

  return workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    if (!sheet) return "";
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false, skipHidden: false });
    return csv.trim() ? `=== sheet: ${name} ===\n${csv.trim()}` : "";
  })
    .filter(Boolean)
    .join("\n\n");
}

const SPREADSHEET = /\.(xlsx|xlsm|xls|csv|ods)$/i;
const IMAGE = /\.(png|jpe?g|gif|webp)$/i;

export function readAttachment(
  filename: string,
  mimeType: string,
  content: Buffer,
): ReadableFile {
  if (SPREADSHEET.test(filename) || mimeType.includes("spreadsheet") || mimeType.includes("excel")) {
    try {
      const text = spreadsheetToText(content);
      if (!text.trim()) {
        return { kind: "unsupported", note: "הגיליון נקרא אבל אין בו תוכן" };
      }
      return { kind: "text", text };
    } catch (err) {
      return {
        kind: "unsupported",
        note: `לא ניתן לקרוא את הגיליון: ${err instanceof Error ? err.message : err}`,
      };
    }
  }

  if (filename.toLowerCase().endsWith(".pdf") || mimeType === "application/pdf") {
    return { kind: "pdf", base64: content.toString("base64"), mediaType: "application/pdf" };
  }

  if (IMAGE.test(filename) || mimeType.startsWith("image/")) {
    const media = mimeType.startsWith("image/") ? mimeType : "image/png";
    return { kind: "image", base64: content.toString("base64"), mediaType: media };
  }

  if (mimeType.startsWith("text/")) {
    return { kind: "text", text: content.toString("utf8").slice(0, 100_000) };
  }

  return { kind: "unsupported", note: `סוג קובץ שלא נתמך: ${mimeType || filename}` };
}
