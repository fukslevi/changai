/** What has already been announced. */
import { db, notifications } from "../lib/db";

async function main() {
  const rows = await db.select().from(notifications);
  console.log(rows.length, "recorded");
  for (const row of rows) {
    console.log(row.kind, row.dedupeKey, row.sentAt?.toISOString());
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
