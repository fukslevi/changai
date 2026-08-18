/**
 * The parked-questions table.
 *
 *   npx tsx --env-file=.env scripts/migrate-open-questions.ts
 */
import { sql } from "drizzle-orm";
import { db } from "../lib/db";

async function main() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS open_questions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      supplier_id uuid REFERENCES suppliers(id),
      message_id uuid REFERENCES messages(id) ON DELETE CASCADE,
      scope text NOT NULL DEFAULT 'project',
      question_en text NOT NULL,
      question_he text NOT NULL,
      why_he text,
      answer text,
      answered_at timestamptz,
      status text NOT NULL DEFAULT 'open',
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS open_questions_project_idx
      ON open_questions (project_id, status)
  `);
  console.log("open_questions ready");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
