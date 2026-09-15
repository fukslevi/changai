/**
 * Turn new rows in the product intake sheet into screening projects.
 *
 * One row is one product, and every non-empty variation on it becomes its
 * own item in the same project - a factory that makes variation A may not
 * make B, and a partial quote is still worth having, exactly as it is for a
 * parsed RFQ.
 *
 * The high-water mark lives in settings, not per-row, because the sheet is
 * append-only by design: a product goes on the bottom, never in the middle.
 * A row already imported is never re-created even if it was later edited -
 * this watches for new products, not corrections to old ones.
 */
import { randomUUID } from "node:crypto";
import { db, items, projects } from "../db";
import { advanceProductIntakeRow, getProductIntakeConfig } from "../settings";
import { fetchIntakeRows, type IntakeRow } from "./sheet";

export interface ImportResult {
  created: { name: string; projectId: string }[];
  skipped: { row: number; name: string; reason: string }[];
}

async function createScreeningProject(row: IntakeRow): Promise<string> {
  const projectId = randomUUID();
  const moq = row.moq as number;
  const price = row.targetExwPrice as number;
  const variations = row.variations.length > 0 ? row.variations : [null];

  await db.transaction(async (tx) => {
    await tx.insert(projects).values({
      id: projectId,
      name: row.productName,
      keywords: [row.productName, `${row.productName} manufacturer`, `${row.productName} factory china`],
      status: "draft",
      projectMode: "screening",
      screeningQuoteTarget: 3,
      autonomyTier: 3,
      maxNegotiationRounds: 3,
      quantityTiers: [moq],
    });

    for (const variation of variations) {
      await tx.insert(items).values({
        projectId,
        name: variation ? `${row.productName} - ${variation}` : row.productName,
        kind: "priced_variant",
        targetPrices: [{ option_id: null, qty: moq, unit_price: price, currency: "USD" }],
      });
    }
  });

  return projectId;
}

export async function importNewProducts(): Promise<ImportResult> {
  const config = await getProductIntakeConfig();
  const result: ImportResult = { created: [], skipped: [] };
  if (!config.sheetUrl) return result;

  const rows = await fetchIntakeRows(config.sheetUrl);
  const newRows = rows.filter((r) => r.rowIndex > config.lastRow);
  if (newRows.length === 0) return result;

  for (const row of newRows) {
    if (row.moq === null || row.targetExwPrice === null) {
      result.skipped.push({
        row: row.rowIndex,
        name: row.productName,
        reason: "חסר MOQ או Target EXW price",
      });
      continue;
    }

    const projectId = await createScreeningProject(row);
    result.created.push({ name: row.productName, projectId });
  }

  // Every row seen this run - successful or not - moves the mark forward, so
  // one bad row can never block every product added after it.
  const highest = Math.max(...rows.map((r) => r.rowIndex));
  await advanceProductIntakeRow(highest);

  return result;
}
