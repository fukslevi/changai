/**
 * Hebrew names for the gap codes, in their own module.
 *
 * The conversation view is a client component, and reply.ts pulls in the
 * database and the Anthropic SDK - neither belongs in a browser bundle.
 */
export const GAP_LABELS: Record<string, string> = {
  unit_price: "מחיר ליחידה בכל מדרגה",
  moq: "כמות מינימלית להזמנה",
  lead_time: "זמן ייצור",
  payment_terms: "תנאי תשלום",
  sample_price: "מחיר וזמן דגימה",
  certificates: "תעודות ותקנים",
  product_photos: "תמונות של המוצר בפועל",
  tooling_cost: "עלות תבנית",
  incoterm: "תנאי מסירה",
  carton_dimensions: "מידות קרטון ויחידות לקרטון",
};
