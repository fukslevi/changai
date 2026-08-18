import { eq } from "drizzle-orm";
import { db, settings } from "./db";

export interface AppSettings {
  senderName: string;
  senderTitle: string;
  sourcingMailbox: string;
  companyName: string;
}

/**
 * Standing commercial rules, inherited by every new project.
 *
 * Duty is nil unless a particular RFQ says otherwise; the return target is
 * company policy; the marketplace fees are the same on every product. Holding
 * them here is what leaves a new project with a single question for a human -
 * the selling price, which is the one thing nothing can derive.
 */
export interface CommercialDefaults {
  targetRoi: number;
  dutyRatePct: number;
  referralPct: number;
  ppcPct: number;
  inboundUsdPerUnit: number;
}

export const FALLBACK_COMMERCIALS: CommercialDefaults = {
  targetRoi: 1,
  dutyRatePct: 0,
  referralPct: 15,
  ppcPct: 10,
  inboundUsdPerUnit: 0.5,
};

function toNumber(value: string | null, fallback: number): number {
  if (value === null) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function getCommercialDefaults(): Promise<CommercialDefaults> {
  const [row] = await db.select().from(settings).where(eq(settings.id, SINGLETON_ID));
  if (!row) return FALLBACK_COMMERCIALS;

  return {
    targetRoi: toNumber(row.defaultTargetRoi, FALLBACK_COMMERCIALS.targetRoi),
    dutyRatePct: toNumber(row.defaultDutyRatePct, FALLBACK_COMMERCIALS.dutyRatePct),
    referralPct: toNumber(row.defaultReferralPct, FALLBACK_COMMERCIALS.referralPct),
    ppcPct: toNumber(row.defaultPpcPct, FALLBACK_COMMERCIALS.ppcPct),
    inboundUsdPerUnit: toNumber(
      row.defaultInboundUsdPerUnit,
      FALLBACK_COMMERCIALS.inboundUsdPerUnit,
    ),
  };
}

const SINGLETON_ID = "default";

/**
 * Database values win; .env is the fallback for a fresh install so the app
 * works before anyone opens the settings page.
 */
export async function getSettings(): Promise<AppSettings> {
  const [row] = await db.select().from(settings).where(eq(settings.id, SINGLETON_ID));

  return {
    senderName: row?.senderName || process.env.SOURCING_SENDER_NAME || "",
    senderTitle: row?.senderTitle || process.env.SOURCING_SENDER_TITLE || "",
    sourcingMailbox: row?.sourcingMailbox || process.env.SOURCING_MAILBOX || "",
    companyName: row?.companyName || "SoSimple",
  };
}

export async function saveSettings(values: AppSettings): Promise<void> {
  await db
    .insert(settings)
    .values({ id: SINGLETON_ID, ...values, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: settings.id,
      set: { ...values, updatedAt: new Date() },
    });
}
