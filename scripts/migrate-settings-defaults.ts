/**
 * Company-wide commercial defaults on the settings row.
 *
 *   npx tsx --env-file=.env scripts/migrate-settings-defaults.ts
 */
import { sql } from "drizzle-orm";
import { db, settings } from "../lib/db";

const COLUMNS: [string, string][] = [
  ["default_target_roi", "numeric(4,2)"],
  ["default_duty_rate_pct", "numeric(5,2)"],
  ["default_referral_pct", "numeric(5,2)"],
  ["default_ppc_pct", "numeric(5,2)"],
  ["default_inbound_usd_per_unit", "numeric(8,2)"],
];

async function main() {
  for (const [name, type] of COLUMNS) {
    await db.execute(sql.raw(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS ${name} ${type}`));
  }

  // The standing rules as stated: duty is nil unless a document says otherwise,
  // and a product must return its own landed cost.
  await db
    .insert(settings)
    .values({
      id: "default",
      defaultTargetRoi: "1",
      defaultDutyRatePct: "0",
      defaultReferralPct: "15",
      defaultPpcPct: "10",
      defaultInboundUsdPerUnit: "0.5",
    })
    .onConflictDoUpdate({
      target: settings.id,
      set: {
        defaultTargetRoi: sql`coalesce(${settings.defaultTargetRoi}, '1')`,
        defaultDutyRatePct: sql`coalesce(${settings.defaultDutyRatePct}, '0')`,
        defaultReferralPct: sql`coalesce(${settings.defaultReferralPct}, '15')`,
        defaultPpcPct: sql`coalesce(${settings.defaultPpcPct}, '10')`,
        defaultInboundUsdPerUnit: sql`coalesce(${settings.defaultInboundUsdPerUnit}, '0.5')`,
      },
    });

  console.log("settings: commercial defaults ready (duty 0%, ROI 1.0)");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
