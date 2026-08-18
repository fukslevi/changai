/**
 * Landed cost and the walk-away price.
 *
 * The rule is one line - a unit must earn back at least its own landed cost -
 * but the reason it needs code is that "landed" is where the money actually
 * goes. On a bulky, cheap product freight and duty together are larger than the
 * factory price, so a 30 cent win on FOB is worth less than a carton that packs
 * one more unit. Two suppliers quoting the identical FOB can differ by dollars
 * per unit once their cartons are measured.
 *
 * Everything here is pure arithmetic over stored assumptions. It is deliberately
 * separate from the quote parser so the same model can answer two questions:
 * "what may we pay?" before anyone has quoted, and "does this quote work?"
 * after they have.
 */

export interface CommercialAssumptions {
  /** 1.0 = the unit must return its own landed cost. */
  targetRoi: number;
  /** Advertising as a share of revenue. */
  ppcPct: number;
  /** Whether the return is measured after advertising is deducted. */
  roiAfterPpc: boolean;
  /** Marketplace commission as a share of revenue. */
  referralPct: number;
  /** Import duty as a share of the customs value. */
  dutyRatePct: number;
  /** Sea freight per cubic metre, door to warehouse. */
  freightUsdPerCbm: number;
  /** Port to fulfilment centre, per unit. */
  inboundUsdPerUnit: number;
}

export interface ProductAssumptions {
  /** Planned selling price. Nothing can be judged without it. */
  targetRetailUsd: number;
  /** Fulfilment fee per unit at that size and weight. */
  fbaFeeUsd: number;
  /** Packed volume per unit. */
  cbmPerUnit: number;
}

export interface LandedBreakdown {
  fob: number;
  freight: number;
  duty: number;
  inbound: number;
  landed: number;
}

export interface Verdict {
  /** Revenue left after the marketplace takes its cut. */
  netRevenue: number;
  /** The most a unit may cost, landed, and still clear the rule. */
  maxLanded: number;
  /** The most we may pay the factory, FOB, given freight and duty. */
  walkAwayFob: number;
  landed: LandedBreakdown | null;
  /** Actual return at the quoted price. Null until there is a price. */
  roi: number | null;
  passes: boolean | null;
  /** Distance from the walk-away. Negative means the quote is too expensive. */
  headroomFob: number | null;
}

/** What the sale leaves once the marketplace has taken its share. */
export function netRevenue(
  commercial: CommercialAssumptions,
  product: ProductAssumptions,
): number {
  const referral = product.targetRetailUsd * (commercial.referralPct / 100);
  const ppc = commercial.roiAfterPpc
    ? product.targetRetailUsd * (commercial.ppcPct / 100)
    : 0;
  return product.targetRetailUsd - referral - product.fbaFeeUsd - ppc;
}

export function landedCost(
  fob: number,
  commercial: CommercialAssumptions,
  cbmPerUnit: number,
): LandedBreakdown {
  const freight = cbmPerUnit * commercial.freightUsdPerCbm;
  // Duty is charged on the customs value, which for these shipments is the FOB
  // price - not on the landed total. Applying it to the total overstates it.
  const duty = fob * (commercial.dutyRatePct / 100);
  const inbound = commercial.inboundUsdPerUnit;
  return { fob, freight, duty, inbound, landed: fob + freight + duty + inbound };
}

/**
 * The walk-away, and the verdict on a quoted price if one is supplied.
 *
 * ROI = (net revenue - landed) / landed, so the rule
 *   ROI >= target
 * rearranges to
 *   landed <= net revenue / (1 + target)
 * and, since duty scales with FOB,
 *   FOB <= (max landed - freight - inbound) / (1 + duty rate)
 */
export function evaluate(
  commercial: CommercialAssumptions,
  product: ProductAssumptions,
  quotedFob?: number,
): Verdict {
  const net = netRevenue(commercial, product);
  const maxLanded = net / (1 + commercial.targetRoi);

  const freight = product.cbmPerUnit * commercial.freightUsdPerCbm;
  const walkAwayFob =
    (maxLanded - freight - commercial.inboundUsdPerUnit) / (1 + commercial.dutyRatePct / 100);

  if (quotedFob === undefined) {
    return {
      netRevenue: net,
      maxLanded,
      walkAwayFob,
      landed: null,
      roi: null,
      passes: null,
      headroomFob: null,
    };
  }

  const landed = landedCost(quotedFob, commercial, product.cbmPerUnit);
  const roi = landed.landed > 0 ? (net - landed.landed) / landed.landed : 0;

  return {
    netRevenue: net,
    maxLanded,
    walkAwayFob,
    landed,
    roi,
    passes: roi >= commercial.targetRoi,
    headroomFob: walkAwayFob - quotedFob,
  };
}

/** A numeric column arrives as a string; null means "not filled in yet". */
export function num(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export interface Readiness {
  ready: boolean;
  /** Hebrew names of what is still missing, for the operator. */
  missing: string[];
}

/**
 * Whether the model can produce a walk-away yet.
 *
 * This gates the campaign. Emailing suppliers before you know your own ceiling
 * means running the whole negotiation blind - and the target price printed in
 * the RFQ is exactly the number this model should have produced.
 */
export function readiness(
  commercial: Partial<CommercialAssumptions>,
  product: Partial<ProductAssumptions>,
): Readiness {
  const missing: string[] = [];

  if (!product.targetRetailUsd) missing.push("מחיר מדף מתוכנן");
  if (product.fbaFeeUsd === undefined || product.fbaFeeUsd === null)
    missing.push("עמלת FBA ליחידה");
  if (!product.cbmPerUnit) missing.push("נפח משוער ליחידה (CBM)");
  if (commercial.dutyRatePct === undefined || commercial.dutyRatePct === null)
    missing.push("שיעור מכס");
  if (!commercial.targetRoi) missing.push("יעד ROI");

  return { ready: missing.length === 0, missing };
}
