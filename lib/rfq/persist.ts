import { eq } from "drizzle-orm";
import { db, items, projects, requirements, rfqValidationIssues } from "../db";
import type { ExtractedRequirement, RfqExtraction } from "./extraction-schema";

/**
 * Write an extraction into the project. Shared by the server action and the
 * headless scripts so there is exactly one definition of how an RFQ lands in
 * the database.
 *
 * Re-parsing replaces prior output rather than accumulating it — two versions
 * of the same requirement set would leave every downstream comparison having to
 * guess which one is current.
 */
export async function persistExtraction(projectId: string, extraction: RfqExtraction) {
  await db.transaction(async (tx) => {
    await tx.delete(requirements).where(eq(requirements.projectId, projectId));
    await tx.delete(items).where(eq(items.projectId, projectId));
    await tx.delete(rfqValidationIssues).where(eq(rfqValidationIssues.projectId, projectId));

    await tx
      .update(projects)
      .set({
        quantityTiers: extraction.quantity_tiers,
        currency: extraction.currency,
        version: extraction.version,
        period: extraction.period,
        status: "sourcing",
      })
      .where(eq(projects.id, projectId));

    // Two passes: insert every item, then resolve parent links by name.
    const idByName = new Map<string, string>();
    for (const item of extraction.items) {
      const [row] = await tx
        .insert(items)
        .values({
          projectId,
          name: item.name,
          kind: item.kind,
          referenceLinks: item.reference_links,
          targetPrices: item.target_prices.map((p) => ({
            qty: p.qty,
            unit_price: p.unit_price,
            currency: extraction.currency,
            option_id: null,
          })),
        })
        .returning({ id: items.id });
      if (row) idByName.set(item.name, row.id);
    }

    for (const item of extraction.items) {
      const parentId = item.parent_item_name ? idByName.get(item.parent_item_name) : undefined;
      const selfId = idByName.get(item.name);
      if (parentId && selfId) {
        await tx.update(items).set({ parentItemId: parentId }).where(eq(items.id, selfId));
      }
    }

    const toRow = (r: ExtractedRequirement, itemId: string | null) => ({
      projectId,
      itemId,
      key: r.key,
      category: r.category,
      text: r.text,
      isMandatory: r.is_mandatory,
      sourceSection: r.source_section,
    });

    const rows = [
      ...extraction.shared_requirements.map((r) => toRow(r, null)),
      ...extraction.items.flatMap((item) =>
        item.requirements.map((r) => toRow(r, idByName.get(item.name) ?? null)),
      ),
    ];

    // The model can repeat a key across sections; (project, key) is unique.
    const deduped = [...new Map(rows.map((r) => [r.key, r])).values()];
    if (deduped.length > 0) await tx.insert(requirements).values(deduped);

    if (extraction.validation_issues.length > 0) {
      await tx.insert(rfqValidationIssues).values(
        extraction.validation_issues.map((v) => ({
          projectId,
          severity: v.severity,
          code: v.code,
          detail: v.detail,
          sourceSection: v.source_section,
        })),
      );
    }
  });

  return {
    items: extraction.items.length,
    requirements:
      extraction.shared_requirements.length +
      extraction.items.reduce((n, i) => n + i.requirements.length, 0),
    issues: extraction.validation_issues.length,
  };
}
