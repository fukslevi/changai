/**
 * Print a stored supplier attachment as text.
 *
 *   npx tsx --env-file=.env scripts/read-attachment.ts Basket.xlsx
 */
import { eq, like } from "drizzle-orm";
import { db, files } from "../lib/db";
import { readAttachment } from "../lib/quotes/read";

async function main() {
  const needle = process.argv[2] ?? "";
  const rows = await db.select().from(files).where(like(files.filename, `%${needle}%`));
  if (rows.length === 0) { console.error(`no stored file matching "${needle}"`); process.exit(1); }

  for (const f of rows) {
    console.log(`=== ${f.filename}  (${f.mimeType}, ${Math.round(f.sizeBytes / 1024)} KB) ===\n`);
    const parsed = readAttachment(f.filename, f.mimeType, f.content);
    if (parsed.text) console.log(parsed.text.slice(0, 6000));
    else console.log(`[${parsed.kind}] ${parsed.note ?? "binary, read directly by the model"}`);
    console.log();
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
