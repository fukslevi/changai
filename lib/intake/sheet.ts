/**
 * Read the operator's product intake sheet as plain rows.
 *
 * Fetched as CSV rather than through the Sheets API: the sheet only has to be
 * shared "anyone with the link", not with a service account, so there is
 * nothing to authenticate and nothing that can expire. XLSX parses the CSV -
 * the same library the RFQ and quote readers already use - so quoted fields
 * with embedded commas or quotes (a screen size written as `10.1"`) are
 * handled correctly rather than by a hand-rolled split on commas.
 */
import * as XLSX from "xlsx";

export interface IntakeRow {
  /** 1-based position among data rows, excluding the header. The dedupe key. */
  rowIndex: number;
  productName: string;
  moq: number | null;
  /** Non-empty "Product variation A/B/C" cells, in column order. */
  variations: string[];
  targetExwPrice: number | null;
}

/** Accepts either the edit URL or a bare sheet id. */
export function parseSheetUrl(url: string): { id: string; gid: string } | null {
  const trimmed = url.trim();
  const idMatch = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/) ?? trimmed.match(/^([a-zA-Z0-9-_]+)$/);
  if (!idMatch) return null;
  const gidMatch = trimmed.match(/[?#&]gid=(\d+)/);
  return { id: idMatch[1]!, gid: gidMatch?.[1] ?? "0" };
}

function parseNumber(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  const cleaned = String(value).replace(/[^0-9.]/g, "");
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function normaliseHeader(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

export async function fetchIntakeRows(sheetUrl: string): Promise<IntakeRow[]> {
  const parsed = parseSheetUrl(sheetUrl);
  if (!parsed) throw new Error("כתובת גיליון לא תקינה");

  const res = await fetch(
    `https://docs.google.com/spreadsheets/d/${parsed.id}/export?format=csv&gid=${parsed.gid}`,
  );
  if (!res.ok) {
    throw new Error(
      `לא ניתן לקרוא את הגיליון (${res.status}) - ודא שהשיתוף הוא "כל מי שיש לו קישור - צופה"`,
    );
  }
  const csv = await res.text();

  const workbook = XLSX.read(csv, { type: "string" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]!];
  if (!sheet) return [];

  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false });
  const [header, ...data] = rows;
  if (!header) return [];

  const headers = header.map(normaliseHeader);
  const nameCol = headers.findIndex((h) => h === "product name");
  const moqCol = headers.findIndex((h) => h === "moq");
  // Not an exact match on purpose - "Target EXW price 500" carries the first
  // product's quantity in its own header text, but the column means the same
  // thing whatever quantity a later row actually has.
  const priceCol = headers.findIndex((h) => h.startsWith("target exw price"));
  const variationCols = headers
    .map((h, i) => ({ h, i }))
    .filter((c) => c.h.startsWith("product variation"))
    .map((c) => c.i);

  if (nameCol === -1 || moqCol === -1 || priceCol === -1) {
    throw new Error(
      'לא נמצאו כל העמודות הנדרשות בגיליון - צריך "product name", "MOQ" ו-"Target EXW price"',
    );
  }

  const out: IntakeRow[] = [];
  data.forEach((row, i) => {
    const productName = String(row[nameCol] ?? "").trim();
    if (!productName) return; // A blank row is not a product, whatever else it carries.

    const moqValue = parseNumber(row[moqCol]);
    out.push({
      rowIndex: i + 1,
      productName,
      moq: moqValue !== null ? Math.round(moqValue) : null,
      variations: variationCols.map((c) => String(row[c] ?? "").trim()).filter(Boolean),
      targetExwPrice: parseNumber(row[priceCol]),
    });
  });

  return out;
}
