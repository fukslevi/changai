/**
 * Load a project's commercial model and answer the walk-away question.
 *
 * Defaults exist for the figures that are the same for almost every Amazon US
 * private-label product (the 15% referral fee, a 10% advertising allowance).
 * The three that decide the outcome - retail price, duty rate, freight - have
 * no default on purpose. A guessed duty rate is the difference between a deal
 * and a loss, and a default would hide that the number was never checked.
 */
import { asc, eq } from "drizzle-orm";
import { db, items, projects } from "../db";
import { getCommercialDefaults } from "../settings";
import { estimateSeaFreight } from "./freight";
import {
  evaluate,
  num,
  readiness,
  type CommercialAssumptions,
  type ProductAssumptions,
  type Readiness,
  type Verdict,
} from "./landed";

/**
 * The walk-away at one quantity tier.
 *
 * There is one per tier because freight per unit is not constant: 500 units of
 * a bulky product ship as loose cargo at a high rate per cubic metre, while
 * 2,500 fill a container and ship for a third of that. The price you can afford
 * to pay therefore rises with the order size, which is the opposite of how a
 * supplier's price behaves - and that spread is the negotiation.
 */
export interface TierWalkAway {
  qty: number;
  freightMode: "lcl" | "fcl";
  freightNote: string;
  freightPerUnit: number;
  walkAwayFob: number;
  /** The RFQ's own target at this tier, when it states one. */
  rfqTargetFob: number | null;
  /** Positive means the target leaves room; negative means it already fails. */
  headroom: number | null;
}

export interface PricedProduct {
  itemId: string;
  name: string;
  /** The RFQ's own target price at the largest tier, for comparison. */
  rfqTargetFob: number | null;
  product: Partial<ProductAssumptions>;
  readiness: Readiness;
  /** Null until every input the model needs is present. */
  verdict: Verdict | null;
  tiers: TierWalkAway[];
}

export interface ProjectPricing {
  commercial: Partial<CommercialAssumptions>;
  hsCode: string | null;
  products: PricedProduct[];
  /** True when every priced product can produce a walk-away. */
  ready: boolean;
  missing: string[];
}

export async function projectPricing(projectId: string): Promise<ProjectPricing> {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) throw new Error("Project not found");

  // The project may override any of these; otherwise the company rule applies.
  const company = await getCommercialDefaults();

  const commercial: Partial<CommercialAssumptions> = {
    targetRoi: num(project.targetRoi) ?? company.targetRoi,
    ppcPct: num(project.ppcPct) ?? company.ppcPct,
    roiAfterPpc: project.roiAfterPpc,
    referralPct: num(project.referralPct) ?? company.referralPct,
    dutyRatePct: num(project.dutyRatePct) ?? company.dutyRatePct,
    freightUsdPerCbm: num(project.freightUsdPerCbm) ?? undefined,
    inboundUsdPerUnit: num(project.inboundUsdPerUnit) ?? company.inboundUsdPerUnit,
  };

  const rows = await db
    .select()
    .from(items)
    .where(eq(items.projectId, projectId))
    .orderBy(asc(items.name));

  const products: PricedProduct[] = [];

  for (const item of rows) {
    // Only things we actually buy a price for carry a retail price of their own.
    if (item.kind !== "priced_variant") continue;

    const product: Partial<ProductAssumptions> = {
      targetRetailUsd: num(item.targetRetailUsd) ?? undefined,
      fbaFeeUsd: num(item.fbaFeeUsd) ?? undefined,
      cbmPerUnit: num(item.assumedCbmPerUnit) ?? undefined,
    };

    const state = readiness(commercial, product);

    // The deepest tier is the one worth planning against - it is the price the
    // programme runs at once the product works.
    const deepestTier = item.targetPrices
      .filter((p) => p.unit_price !== null)
      .sort((a, b) => (b.qty ?? 0) - (a.qty ?? 0))[0];

    // One walk-away per quantity tier, each with its own freight rate.
    const tiers: TierWalkAway[] = [];
    if (state.ready) {
      const full = commercial as CommercialAssumptions;
      const full_product = product as ProductAssumptions;

      for (const qty of project.quantityTiers) {
        const freight = estimateSeaFreight(full_product.cbmPerUnit * qty);
        const perTier = evaluate(
          { ...full, freightUsdPerCbm: freight.usdPerCbm },
          full_product,
        );
        const target =
          item.targetPrices.find((p) => p.qty === qty)?.unit_price ?? null;

        tiers.push({
          qty,
          freightMode: freight.mode,
          freightNote: freight.note,
          freightPerUnit: freight.usdPerCbm * full_product.cbmPerUnit,
          walkAwayFob: perTier.walkAwayFob,
          rfqTargetFob: target,
          headroom: target === null ? null : perTier.walkAwayFob - target,
        });
      }
    }

    products.push({
      itemId: item.id,
      name: item.name,
      rfqTargetFob: deepestTier?.unit_price ?? null,
      product,
      readiness: state,
      verdict: state.ready
        ? evaluate(commercial as CommercialAssumptions, product as ProductAssumptions)
        : null,
      tiers,
    });
  }

  const missing = [...new Set(products.flatMap((p) => p.readiness.missing))];

  return {
    commercial,
    hsCode: project.hsCode,
    products,
    ready: products.length > 0 && products.every((p) => p.readiness.ready),
    missing,
  };
}
