/**
 * SOSIMPLE Sourcing Agent — Canonical Schema
 *
 * Validated against four real artifacts:
 *   RFQ VEST.pdf                → 3 priced variants + 1 included addon + 1 optional
 *   RFQ Bike Basket Rear.pdf    → 2 priced items + 4 spec'd-but-unpriced components
 *   Cold Therapy Machine.pdf    → 6-line BOM quote @ 500/1000/1500
 *   Vacuum sealer.pdf           → the comparison sheet = the output shape
 *
 * The same Zod schemas serve three jobs:
 *   1. Database model (Drizzle tables mirror these)
 *   2. LLM structured output for extraction (zodOutputFormat + claude-opus-5)
 *   3. Compliance matrix join keys
 */

import { z } from "zod";

/* ─────────────────────────────────────────────────────────────
 * Shared primitives
 * ───────────────────────────────────────────────────────────── */

/**
 * Quantity tiers are PER PROJECT — there is no global default.
 *   Vest        → 500 / 1000 / 1500
 *   Bike Basket → 500 / 1500 / 2500
 * A wrong default here produces silently wrong price comparisons,
 * so the field is required and read from the RFQ's own pricing table.
 */

/**
 * The pricing axis is NOT always quantity. Three real quotes, two axes:
 *   Cold Therapy / Vacuum Sealer → columns are quantity tiers
 *   Mattress Vacuum              → columns are configuration Options 1-7,
 *                                  with no quantity dimension at all
 * The extractor must CLASSIFY the axis before reading any value. Assuming
 * "columns = quantities" silently produces garbage on option-axis quotes.
 */
export const PricingAxis = z.enum(["quantity_tier", "configuration_option", "both"]);

export const PricePoint = z.object({
  /** Null when the axis is quantity only. */
  option_id: z.string().nullable(),
  /** Null when the axis is configuration only. */
  qty: z.number().int().positive().nullable(),
  unit_price: z.number().nullable(),
  currency: z.string().default("USD"),
});

/**
 * A configuration the supplier offers as an alternative. Mattress Vacuum
 * quoted seven, each a different vacuum variant plus the same four shared
 * accessories. Note options 1 and 5 priced identically (23.31) while
 * differing sharply on compliance — price alone cannot rank them.
 */
export const QuoteOption = z.object({
  id: z.string(), // "option_1"
  label: z.string(), // "Option 1"
  /** The line item whose choice defines this option (rows 1-7 above). */
  defining_line_item_seq: z.number().int().nullable(),
  stated_total: z.number().nullable(),
  computed_total: z.number().nullable(), // sum of the option's line items
  /**
   * stated − computed. Every Mattress Vacuum option was 1-2 cents low,
   * systematically — the displayed unit prices are rounded and the real
   * figures carry hidden decimals. Systematic ≠ noise; surface it.
   */
  total_discrepancy: z.number().nullable(),
});

export const Incoterm = z.enum(["EXW", "FOB", "CIF", "DDP", "FCA", "UNKNOWN"]);

export const LeadTime = z.object({
  min_days: z.number().int().nullable(),
  max_days: z.number().int().nullable(),
  raw: z.string().nullable(), // "5to10days" — always keep the original
});

export const PaymentTerms = z.object({
  deposit_pct: z.number().nullable(), // "50%" → 50
  balance_trigger: z.string().nullable(), // "before shipment" / "against BL copy"
  raw: z.string().nullable(),
});

/* ─────────────────────────────────────────────────────────────
 * RFQ side — what we asked for
 * ───────────────────────────────────────────────────────────── */

export const RequirementCategory = z.enum([
  "material",
  "dimensions",
  "weight_capacity",
  "structure",
  "mounting",
  "feature",
  "color",
  "packaging",
  "insert_manual",
  "logo_branding",
  "certification",
  /** Bike Basket slide 11 — a defect from a PRIOR production run to correct. */
  "quality_issue",
  "other",
]);

export const Requirement = z.object({
  id: z.string(), // REQ_BASKET_MATERIAL — stable join key into ComplianceCheck
  category: RequirementCategory,
  text: z.string(), // verbatim bullet from the RFQ
  /**
   * Inferred from RFQ language, never a filled field:
   *   "important" / "must" / "should meet" / spec bullets → true
   *   "to consider" / "check the option"                  → false
   */
  is_mandatory: z.boolean(),
  /** The "Slide N: Title" heading it came from — both RFQ formats carry these. */
  source_section: z.string().nullable(),
  source_page: z.number().int().nullable(),
});

/**
 * One abstraction replaces the earlier Model/Addon split, which did not
 * survive the second RFQ.
 *
 *   priced_variant     — has its own target-price table (Vest Model 1-3;
 *                        Rear Basket; Folding Rear Basket)
 *   bundled_component  — full spec, no price of its own; ships inside a
 *                        parent item (PU Bag, Waterproof Cover, Cargo Net)
 *   optional_addon     — "to consider" / not yet committed (hydration bladder)
 */
export const ItemKind = z.enum(["priced_variant", "bundled_component", "optional_addon"]);

export const Item = z.object({
  id: z.string(), // "rear_bike_basket"
  name: z.string(), // "Rear Bike Basket"
  kind: ItemKind,
  /** Set on bundled_component to say which priced item it ships inside. */
  parent_item_id: z.string().nullable(),
  /**
   * Reference links are NOT 1:1 with items — the Bike Basket RFQ reuses
   * a single Amazon listing URL across four different components.
   */
  reference_links: z.array(z.string()).default([]),
  requirements: z.array(Requirement),
  /** Empty on bundled_component. Empty on a priced_variant = RFQ defect. */
  target_prices: z.array(PricePoint).default([]),
});

export const Project = z.object({
  id: z.string(),
  name: z.string(), // "Rear Bike Basket"
  version: z.string().nullable(), // "1.0" — RFQs get revised
  period: z.string().nullable(), // "February 2025"
  status: z.enum(["draft", "sourcing", "negotiating", "sampling", "closed"]),
  /** Required. Read from the RFQ pricing tables — never assumed. */
  quantity_tiers: z.array(z.number().int()),
  currency: z.string().default("USD"),
  items: z.array(Item),
  /** Requirements applying across every item — packaging, certs, insert, logo. */
  shared_requirements: z.array(Requirement).default([]),
  source_rfq_file: z.string().nullable(),
});

/**
 * RFQ self-validation — runs BEFORE the RFQ goes out to suppliers.
 * Both real RFQs failed at least one of these checks.
 */
export const RfqValidationIssue = z.object({
  project_id: z.string(),
  severity: z.enum(["error", "warning"]),
  code: z.enum([
    "priced_variant_without_target_price", // Triangle Bag: full spec, no price
    "foreign_product_name", // "Carton Box for Director Chair"
    "quantity_tiers_inconsistent_across_items",
    "reference_link_unreachable",
    "contradictory_requirements",
    "certification_requirement_unspecified",
    /**
     * Alibaba rejects an RFQ post outright when material, size, or a product
     * photo is missing. Check before submitting, not after — a rejection costs
     * a full day of supplier response time.
     */
    "missing_dimensions",
    "missing_materials",
    "missing_product_photo",
    "missing_quantity_tiers",
    /**
     * The posted RFQ text disagrees with the source spec deck. Marketplace
     * "generate my RFQ" assistants produce confident, plausible specifications
     * that were never in the source document — and every quote that comes back
     * is then priced against the wrong product. Diff before posting.
     */
    "spec_diverges_from_source_document",
    /** A priced item in the source deck is absent from the posted RFQ. */
    "source_item_missing_from_post",
  ]),
  detail: z.string(),
  source_section: z.string().nullable(),
});

/* ─────────────────────────────────────────────────────────────
 * Supplier side — who we're talking to
 * ───────────────────────────────────────────────────────────── */

export const Supplier = z.object({
  id: z.string(),
  contact_name: z.string().nullable(), // "Ivy Zhang"
  company_name: z.string().nullable(),
  company_address: z.string().nullable(),
  /** Where the relationship currently lives. Drives Channel Graduation. */
  primary_channel: z.enum(["alibaba", "email", "whatsapp", "wechat"]),
  email: z.string().nullable(),
  whatsapp: z.string().nullable(),
  wechat: z.string().nullable(),
  alibaba_profile_url: z.string().nullable(),
  /** Accumulates across projects — the supplier DB built as a by-product. */
  first_seen_project_id: z.string().nullable(),
});

/* ─────────────────────────────────────────────────────────────
 * Quote side — what came back
 *
 * A quote is a BOM, not a single price. Every real document is a list of
 * line items priced per quantity tier, summing to a total.
 * ───────────────────────────────────────────────────────────── */

export const LineItem = z.object({
  seq: z.number().int(),
  name: z.string(), // "Vacuum sealer" / "PU Bag" / "Packaging"
  /** Resolved against Project.items where possible — drives the compliance join. */
  matched_item_id: z.string().nullable(),
  description: z.string().nullable(),
  dimensions: z.string().nullable(),
  colors: z.string().nullable(),
  materials: z.string().nullable(),
  certificate: z.string().nullable(), // usually EMPTY on arrival → Tier-0 chase
  prices: z.array(PricePoint),

  /**
   * Carton dimensions — NOT product dimensions. These drive freight cost and
   * Amazon FBA eligibility, and they are where oversize problems surface.
   * Fiddle Leaf: the 185cm carton is the one the supplier warned about, and it
   * carried 78% of the order value.
   */
  carton_dimensions_cm: z.string().nullable(), // "185x32x18cm"
  units_per_carton: z.number().int().nullable(),
  carton_count: z.number().int().nullable(),
  cbm: z.number().nullable(),
  /** Quoted line quantity — sums must be checked against the stated total. */
  quantity: z.number().int().nullable(),
  /** Vision: does the supplier's photo match the reference product we sent? */
  supplier_image_ref: z.string().nullable(),
  our_image_ref: z.string().nullable(),
  image_match_verdict: z.enum(["match", "mismatch", "unclear", "not_checked"]).default("not_checked"),
  remark: z.string().nullable(),
});

export const Quote = z.object({
  id: z.string(),
  project_id: z.string(),
  supplier_id: z.string(),
  /** Which priced item this quote answers. Null if it covers the whole kit. */
  item_id: z.string().nullable(),
  /** Suppliers revise. Never overwrite — append. */
  version: z.number().int().default(1),
  received_at: z.string(), // ISO 8601
  source_file: z.string().nullable(),

  /** Classify FIRST, then extract. See PricingAxis. */
  pricing_axis: PricingAxis,
  /** Non-empty only when pricing_axis includes configuration_option. */
  options: z.array(QuoteOption).default([]),

  /**
   * Line items and the landed total can sit at DIFFERENT incoterms. The Fiddle
   * Leaf quote prices every line EXW, adds a single freight line, and lands at
   * DDP. Comparing its $24,842 DDP total against another supplier's EXW total
   * is the easiest possible way to pick the wrong supplier.
   */
  line_incoterm: Incoterm.default("UNKNOWN"),
  landed_incoterm: Incoterm.nullable(),
  freight_charge: z.number().nullable(), // "DDP shipping to Dallas TX" — $9,642
  landed_total: z.number().nullable(), // $24,842
  destination: z.string().nullable(),

  /**
   * The rest were absent entirely from the Mattress Vacuum quote. Nulls here
   * are the single largest source of Tier-0 auto-chase questions.
   */
  currency: z.string().default("USD"),
  lead_time: LeadTime,
  payment_terms: PaymentTerms,
  sample_price: z.number().nullable(),
  moq: z.number().int().nullable(),
  /** "Valid for 15 days" — an expired quote sitting in the table misleads. */
  valid_until: z.string().nullable(),
  quote_number: z.string().nullable(), // "PIDYN24072503"

  line_items: z.array(LineItem),
  /** Grand totals. Verified against sum(line_items) — mismatch is a flag. */
  totals: z.array(PricePoint),
  /**
   * True when the supplier quoted at tiers other than Project.quantity_tiers.
   * Common, and it makes the comparison table non-comparable until resolved.
   */
  tier_mismatch: z.boolean().default(false),

  notes: z.string().nullable(),
});

/* ─────────────────────────────────────────────────────────────
 * Comparison — the join that produces the sheet
 * ───────────────────────────────────────────────────────────── */

export const ComplianceCheck = z.object({
  quote_id: z.string(),
  /** Which configuration this verdict applies to, when the quote has options. */
  option_id: z.string().nullable(),
  requirement_id: z.string(),
  /**
   * `disputed` is distinct from `fails`: the supplier is not failing to meet
   * the requirement, they are challenging whether the requirement is valid.
   * Mattress Vacuum: all 7 options "fail" 550W/18000Pa because that figure
   * is a competitor's falsified listing. Never auto-reject on `disputed`.
   */
  status: z.enum(["meets", "fails", "missing", "unclear", "disputed"]),
  evidence: z.string().nullable(), // quote text supporting the verdict
  confidence: z.enum(["high", "medium", "low"]),
});

/**
 * A supplier challenging the RFQ itself — the feedback loop from quotes back
 * into requirements. Escalates to a human immediately; never auto-resolved.
 *
 * Cross-supplier corroboration is what makes this trustworthy: one supplier
 * saying a spec is impossible is an excuse, five saying it is a fact. The
 * agent counts agreeing suppliers automatically.
 */
export const RequirementChallenge = z.object({
  id: z.string(),
  project_id: z.string(),
  requirement_id: z.string(),
  quote_id: z.string(),
  supplier_id: z.string(),
  claim: z.string(), // verbatim supplier text
  challenge_type: z.enum([
    "spec_based_on_false_benchmark", // "competitors list 400W as 550W"
    "spec_physically_unachievable",
    "spec_degrades_user_experience", // "higher suction sticks to the mattress"
    "spec_ambiguous",
    "cost_disproportionate",
    /**
     * The spec is buildable but fails a constraint the RFQ never considered —
     * FBA dimensional limits, customs, carrier restrictions, regulatory.
     * Fiddle Leaf: "the tree style package is over length for Amazon warehouse."
     * Highest-severity class: it invalidates the order after production.
     */
    "downstream_constraint_violation",
  ]),
  supporting_evidence: z.string().nullable(), // "verifiable by lab test"
  /** Suppliers usually pair a challenge with a fix — "change to detachable model". */
  supplier_proposed_alternative: z.string().nullable(),
  /** Other suppliers independently making the same claim. */
  corroborating_supplier_ids: z.array(z.string()).default([]),
  status: z.enum(["open", "under_review", "accepted_rfq_revised", "rejected"]),
});

/** Every `missing` compliance check and every null contract field becomes a Gap. */
export const Gap = z.object({
  id: z.string(),
  quote_id: z.string(),
  field: z.string(), // "certificate" | "lead_time" | "REQ_BASKET_MATERIAL"
  question_en: z.string(),
  question_zh: z.string().nullable(),
  asked_at: z.string().nullable(),
  resolved_at: z.string().nullable(),
});

export const PriceGap = z.object({
  quote_id: z.string(),
  item_id: z.string().nullable(),
  qty: z.number().int(),
  target_price: z.number(),
  quoted_price: z.number(),
  delta_abs: z.number(),
  delta_pct: z.number(),
  verdict: z.enum(["at_or_below_target", "within_band", "above_walkaway"]),
});

/**
 * Cross-cutting checks that run on every parsed quote. Each one was found by
 * hand in a real document and is worth real money — they are the reason the
 * comparison table exists rather than a folder of PDFs.
 */
export const QuoteAnomaly = z.object({
  quote_id: z.string(),
  code: z.enum([
    /**
     * Two options with textually identical specs at different prices.
     * Bed Wedge: A and C both "white 25D blue 30D", $8.96 vs $11.82 (+32%).
     * The real difference was visible only in the photos.
     */
    "identical_specs_different_price",
    /** Line item shows no price movement across quantity tiers. */
    "flat_volume_pricing",
    /** Two tiers priced the same — Bed Wedge 1500 and 2500 both 8.81. */
    "duplicate_tier_pricing",
    /** stated_total != sum(line_items). Seen at 1-2 cents, systematically low. */
    "total_rounding_discrepancy",
    /** Same product, options differ only by a finish/color surcharge. */
    "cosmetic_option_surcharge",
    /** Item No repeated in the source table — never key on it. */
    "duplicate_item_number",
    /**
     * Stated total quantity != sum(line quantities). Fiddle Leaf declared
     * "300 PCS" against line items summing to 1,150 — a 3.8x error in unit
     * economics for anyone who reads the summary row, which is everyone.
     * Money columns were correct, so nothing else flagged it.
     */
    "total_quantity_mismatch",
    /** Stated carton count != sum(line cartons). Fiddle Leaf: 300 vs 289. */
    "total_carton_mismatch",
    /** Quote is past its stated validity window. */
    "quote_expired",
    /** Untranslated CN labels ("合计") or option names colliding with column headers. */
    "ambiguous_or_untranslated_label",
  ]),
  detail: z.string(),
  /** Populated when the anomaly has a computable cost at the top tier. */
  cost_impact_at_max_qty: z.number().nullable(),
  /** Set when the anomaly should become an outbound Tier-0 question. */
  suggested_question_en: z.string().nullable(),
});

/**
 * The volume-discount curve is a negotiation lever in its own right.
 * Vacuum Sealer: supplier dropped 3% across a 3x volume increase while the
 * target curve expected 18% — the gap WIDENS with quantity. Computed per quote.
 */
export const DiscountCurve = z.object({
  quote_id: z.string(),
  item_id: z.string().nullable(),
  supplier_discount_pct: z.number(), // lowest tier → highest tier
  target_discount_pct: z.number(),
  /** True when the supplier is effectively offering no volume pricing. */
  is_flat: z.boolean(),
});

/* ─────────────────────────────────────────────────────────────
 * Negotiation mandate — auto-seeded from the RFQ target price table
 * ───────────────────────────────────────────────────────────── */

export const NegotiationMandate = z.object({
  project_id: z.string(),
  item_id: z.string().nullable(),
  target_prices: z.array(PricePoint), // copied from Item.target_prices
  /**
   * Either filled per item, or derived from a single org-wide margin rule.
   * The only input in the whole system with no upstream document.
   */
  walkaway_prices: z.array(PricePoint),
  min_gross_margin_pct: z.number().nullable(),
  acceptable_incoterms: z.array(Incoterm),
  max_lead_time_days: z.number().int().nullable(),
  mandatory_certifications: z.array(z.string()),
  max_tooling_cost: z.number().nullable(),
  max_rounds: z.number().int().default(4),
  tone: z.enum(["formal", "friendly_direct"]).default("friendly_direct"),
  /** Autonomy ceiling for this project. See tiered model. */
  max_autonomy_tier: z.union([z.literal(0), z.literal(1), z.literal(2)]).default(1),
  escalation_triggers: z.array(z.string()).default([
    "payment_terms",
    "exclusivity",
    "legal",
    "volume_commitment",
    "tooling_cost",
  ]),
});

/* ─────────────────────────────────────────────────────────────
 * Type exports
 * ───────────────────────────────────────────────────────────── */

export type Project = z.infer<typeof Project>;
export type Item = z.infer<typeof Item>;
export type Requirement = z.infer<typeof Requirement>;
export type RfqValidationIssue = z.infer<typeof RfqValidationIssue>;
export type Supplier = z.infer<typeof Supplier>;
export type Quote = z.infer<typeof Quote>;
export type LineItem = z.infer<typeof LineItem>;
export type PricingAxis = z.infer<typeof PricingAxis>;
export type PricePoint = z.infer<typeof PricePoint>;
export type QuoteOption = z.infer<typeof QuoteOption>;
export type Incoterm = z.infer<typeof Incoterm>;
export type LeadTime = z.infer<typeof LeadTime>;
export type PaymentTerms = z.infer<typeof PaymentTerms>;
export type ItemKind = z.infer<typeof ItemKind>;
export type RequirementCategory = z.infer<typeof RequirementCategory>;
export type QuoteAnomaly = z.infer<typeof QuoteAnomaly>;
export type ComplianceCheck = z.infer<typeof ComplianceCheck>;
export type RequirementChallenge = z.infer<typeof RequirementChallenge>;
export type Gap = z.infer<typeof Gap>;
export type PriceGap = z.infer<typeof PriceGap>;
export type DiscountCurve = z.infer<typeof DiscountCurve>;
export type NegotiationMandate = z.infer<typeof NegotiationMandate>;
