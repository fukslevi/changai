/** Notification recipient, sent-log, and the project pause switch. */
import { eq, sql } from "drizzle-orm";
import { db, settings } from "../lib/db";

async function main() {
  await db.execute(sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS paused_at timestamptz`);
  await db.execute(sql`ALTER TABLE settings ADD COLUMN IF NOT EXISTS notify_email text`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS notifications (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      kind text NOT NULL,
      dedupe_key text NOT NULL,
      sent_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedupe_idx
      ON notifications (project_id, kind, dedupe_key)
  `);

  await db
    .update(settings)
    .set({ notifyEmail: "ori@sosimple.co.il" })
    .where(eq(settings.id, "default"));

  console.log("notifications ready · recipient ori@sosimple.co.il");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
