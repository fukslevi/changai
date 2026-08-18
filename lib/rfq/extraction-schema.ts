/**
 * The shape Claude fills in when reading an RFQ document.
 *
 * Deliberately separate from lib/schema.ts. That file is the domain model;
 * this one is tuned for structured output — flat, no constraints beyond types
 * (min/max and recursive schemas are not supported by the API), and it uses
 * names rather than UUIDs because the model has no idea what our IDs are.
 */

import { z } from "zod";

export const ExtractedRequirement = z.object({
  /** Stable uppercase key, e.g. REQ_BASKET_MATERIAL. Used to join to quotes. */
  key: z.string(),
  category: z.enum([
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
    "quality_issue",
    "other",
  ]),
  /** Verbatim from the document — never paraphrased. */
  text: z.string(),
  is_mandatory: z.boolean(),
  source_section: z.string().nullable(),
});

export const ExtractedItem = z.object({
  name: z.string(),
  kind: z.enum(["priced_variant", "bundled_component", "optional_addon"]),
  /** Name of the priced item this ships inside, when kind is bundled_component. */
  parent_item_name: z.string().nullable(),
  reference_links: z.array(z.string()),
  target_prices: z.array(
    z.object({
      qty: z.number(),
      unit_price: z.number().nullable(),
    }),
  ),
  requirements: z.array(ExtractedRequirement),
});

export const ExtractedValidationIssue = z.object({
  severity: z.enum(["error", "warning"]),
  code: z.enum([
    "priced_variant_without_target_price",
    "foreign_product_name",
    "quantity_tiers_inconsistent_across_items",
    "contradictory_requirements",
    "certification_requirement_unspecified",
    "missing_dimensions",
    "missing_materials",
    "missing_product_photo",
    "missing_quantity_tiers",
  ]),
  detail: z.string(),
  source_section: z.string().nullable(),
});

export const RfqExtraction = z.object({
  product_name: z.string(),
  version: z.string().nullable(),
  period: z.string().nullable(),
  currency: z.string(),
  /** Read from the document's own pricing table. Empty if it has none. */
  quantity_tiers: z.array(z.number()),
  items: z.array(ExtractedItem),
  /** Requirements that apply across every item — packaging, certs, insert. */
  shared_requirements: z.array(ExtractedRequirement),
  /** Problems with the RFQ itself, found while reading it. */
  validation_issues: z.array(ExtractedValidationIssue),
});

export type RfqExtraction = z.infer<typeof RfqExtraction>;
export type ExtractedItem = z.infer<typeof ExtractedItem>;
export type ExtractedRequirement = z.infer<typeof ExtractedRequirement>;
