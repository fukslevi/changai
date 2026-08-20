/** Raw quote readings, one per supplier reply that carries pricing. */
import { sql } from "drizzle-orm";
import { db } from "../lib/db";

async function main() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS quote_readings (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      supplier_id uuid NOT NULL REFERENCES suppliers(id),
      message_id uuid REFERENCES messages(id) ON DELETE CASCADE,
      currency text NOT NULL DEFAULT 'USD',
      incoterm text,
      incoterm_place text,
      lines jsonb NOT NULL DEFAULT '[]'::jsonb,
      moq integer,
      lead_time_days integer,
      payment_terms text,
      sample_price numeric(10,2),
      sample_lead_time_days integer,
      tooling_cost numeric(10,2),
      certificates jsonb NOT NULL DEFAULT '[]'::jsonb,
      units_per_carton integer,
      carton_dimensions_cm text,
      carton_gross_weight_kg numeric(8,2),
      deviations jsonb NOT NULL DEFAULT '[]'::jsonb,
      rejects_target_price boolean NOT NULL DEFAULT false,
      price_objection text,
      summary_he text,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS quote_readings_project_idx
      ON quote_readings (project_id, supplier_id)
  `);
  console.log("quote_readings ready");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
