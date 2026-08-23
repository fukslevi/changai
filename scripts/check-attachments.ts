/** Which stored attachments are too big to send, measured the way the API does. */
import { db, files } from "../lib/db";
import { readAttachment } from "../lib/quotes/read";

const MAX_IMAGE_BASE64 = 10 * 1024 * 1024;

async function main() {
  const rows = await db
    .select({
      id: files.id,
      filename: files.filename,
      mimeType: files.mimeType,
      content: files.content,
    })
    .from(files);

  for (const row of rows) {
    if (!row.content) continue;
    const parsed = readAttachment(row.filename, row.mimeType, row.content);
    if (parsed.kind !== "image" || !parsed.base64) continue;

    const raw = row.content.length;
    const encoded = parsed.base64.length;
    const verdict = encoded <= MAX_IMAGE_BASE64 ? "sent" : "described";
    console.log(
      `${row.filename}: raw ${(raw / 1024 / 1024).toFixed(2)}MB, base64 ${(encoded / 1024 / 1024).toFixed(2)}MB -> ${verdict}`,
    );
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
