/**
 * The target price is the model.
 *
 * There used to be a landed-cost calculation here that derived a ceiling from
 * retail price, marketplace fees, advertising and freight - on the assumption
 * that the target price in the RFQ was a wish somebody had typed. It is not.
 * The target is the output of the buyer's own analysis, done before the RFQ was
 * written, and every input the model asked for was work already done once.
 *
 * So the arithmetic is one line: how far is this quote from the target. The
 * threshold is the only judgement, and it belongs to the operator.
 */

/**
 * How close a quote has to land to be worth taking forward.
 *
 * Above this the conversation continues; nothing is accepted. It is a goal
 * rather than a cliff, which is why the gap is always shown as a number and
 * never reduced to a pass mark.
 */
export const ACCEPTABLE_GAP_PCT = 20;

export interface TargetVerdict {
  /** Their price. */
  quoted: number;
  /** Ours. */
  target: number;
  /** Positive when they are above target. 50 means half again as much. */
  gapPct: number;
  /** Within the acceptable band. */
  acceptable: boolean;
}

export function compareToTarget(
  quoted: number,
  target: number,
  acceptableGapPct = ACCEPTABLE_GAP_PCT,
): TargetVerdict {
  // Guard against a target of zero rather than returning Infinity into a table.
  const gapPct = target > 0 ? ((quoted - target) / target) * 100 : 0;
  return {
    quoted,
    target,
    gapPct,
    acceptable: gapPct <= acceptableGapPct,
  };
}

/** The most we would agree to pay, given the target and the accepted gap. */
export function ceilingFor(target: number, acceptableGapPct = ACCEPTABLE_GAP_PCT): number {
  return target * (1 + acceptableGapPct / 100);
}
