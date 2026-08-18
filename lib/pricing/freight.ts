/**
 * Sea freight estimate, per cubic metre.
 *
 * The rate is not a constant. Below roughly a quarter of a container you pay
 * LCL, which carries fixed destination charges spread over very little volume;
 * past that a full container is cheaper per cubic metre than loose cargo. So
 * the same product has a different landed cost at 500 units than at 2,500, and
 * therefore a different walk-away price at each quantity tier. Quoting one
 * freight number across all three tiers hides that.
 *
 * These are planning averages for China to US West Coast, all-in to the
 * warehouse. They are deliberately visible and editable: a real quote from a
 * forwarder beats any table, and the moment one exists it should replace this.
 */

/** Usable volume in a 40ft high cube once cartons are stacked realistically. */
const FCL_40HQ_CBM = 60;

/** All-in for a 40HQ, ocean plus destination and drayage. */
const FCL_40HQ_USD = 3600;

/** LCL per cbm, ocean plus destination charges, which do not scale down. */
const LCL_USD_PER_CBM = 145;

/** LCL below this much volume carries minimum charges that inflate the rate. */
const LCL_MINIMUM_CBM = 2;

export type FreightMode = "lcl" | "fcl";

export interface FreightEstimate {
  mode: FreightMode;
  usdPerCbm: number;
  totalCbm: number;
  /** How many 40HQ containers the shipment fills, for the operator's sense of scale. */
  containers: number;
  /** Hebrew, one line, shown next to the number. */
  note: string;
}

/**
 * Cheapest sensible sea rate for a given shipment volume.
 *
 * Full containers are priced whole, so a shipment slightly over a container
 * boundary pays for the empty space - which is exactly the case where packing
 * one more unit into a carton is worth more than any price negotiation.
 */
export function estimateSeaFreight(totalCbm: number): FreightEstimate {
  const billableCbm = Math.max(totalCbm, LCL_MINIMUM_CBM);
  const lclOnly = billableCbm * LCL_USD_PER_CBM;

  if (totalCbm <= 0) {
    return {
      mode: "lcl",
      usdPerCbm: LCL_USD_PER_CBM,
      totalCbm: 0,
      containers: 0,
      note: "אין נפח לחישוב",
    };
  }

  // A shipment that spills just past a container does not buy a second empty
  // one - it ships full containers plus the remainder as loose cargo. Rounding
  // up instead made the 2,500 tier look more expensive than the 1,500 tier,
  // which would have argued against the larger order for no real reason.
  const fullContainers = Math.floor(totalCbm / FCL_40HQ_CBM);
  const remainder = totalCbm - fullContainers * FCL_40HQ_CBM;
  const mixed =
    fullContainers * FCL_40HQ_USD + Math.max(remainder, remainder > 0 ? LCL_MINIMUM_CBM : 0) * LCL_USD_PER_CBM;
  const roundedUp = Math.ceil(totalCbm / FCL_40HQ_CBM) * FCL_40HQ_USD;

  const best = Math.min(lclOnly, mixed, roundedUp);

  if (best === lclOnly) {
    return {
      mode: "lcl",
      usdPerCbm: lclOnly / totalCbm,
      totalCbm,
      containers: 0,
      note:
        totalCbm < LCL_MINIMUM_CBM
          ? `משלוח מאוחד, מתחת למינימום החיוב של ${LCL_MINIMUM_CBM} קוב`
          : `משלוח מאוחד, ${totalCbm.toFixed(1)} קוב`,
    };
  }

  if (best === mixed && remainder > 0) {
    return {
      mode: "fcl",
      usdPerCbm: mixed / totalCbm,
      totalCbm,
      containers: fullContainers,
      note: `${fullContainers} מכולות 40HQ מלאות + ${remainder.toFixed(1)} קוב במשלוח מאוחד`,
    };
  }

  const containers = Math.ceil(totalCbm / FCL_40HQ_CBM);
  return {
    mode: "fcl",
    usdPerCbm: roundedUp / totalCbm,
    totalCbm,
    containers,
    note:
      containers === 1
        ? `מכולה אחת 40HQ, ${totalCbm.toFixed(1)} קוב מתוך ${FCL_40HQ_CBM}`
        : `${containers} מכולות 40HQ, ${totalCbm.toFixed(1)} קוב`,
  };
}

/** Freight per unit at a given order quantity. */
export function freightPerUnit(cbmPerUnit: number, quantity: number): number {
  if (cbmPerUnit <= 0 || quantity <= 0) return 0;
  return estimateSeaFreight(cbmPerUnit * quantity).usdPerCbm * cbmPerUnit;
}
