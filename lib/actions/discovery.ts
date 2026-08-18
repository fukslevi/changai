"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, supplierLeads, suppliers } from "../db";
import { enrichDomain } from "../discovery/enrich";
import { runDiscovery } from "../discovery/run";

export type DiscoveryState = { error?: string; ok?: string };

export async function findSuppliers(
  _prev: DiscoveryState,
  formData: FormData,
): Promise<DiscoveryState> {
  const projectId = String(formData.get("projectId") ?? "");
  if (!projectId) return { error: "Missing project" };

  try {
    const result = await runDiscovery(projectId);
    revalidatePath(`/projects/${projectId}`);
    return {
      ok: `נמצאו ${result.searched} אתרים · ${result.withEmail} עם כתובת מייל · ${result.saved} נשמרו לאישור`,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "החיפוש נכשל" };
  }
}

/**
 * Re-crawl one company site for a contact address.
 *
 * A missing email means "the crawler did not find one", never "this company has
 * no mailbox" - the operator found lumi.cn's address by eye in seconds. This
 * retries a single lead without paying for a whole discovery run.
 */
export async function refreshLeadEmail(
  _prev: DiscoveryState,
  formData: FormData,
): Promise<DiscoveryState> {
  const leadId = String(formData.get("leadId") ?? "");
  const projectId = String(formData.get("projectId") ?? "");
  if (!leadId || !projectId) return { error: "Missing lead" };

  const [lead] = await db.select().from(supplierLeads).where(eq(supplierLeads.id, leadId));
  if (!lead) return { error: "Lead not found" };
  if (!lead.website) return { error: `אין אתר ל-${lead.companyName}` };

  const domain = lead.website.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const contact = await enrichDomain(domain, { seedUrl: lead.sourceUrl ?? undefined });

  if (!contact.primaryEmail) {
    return {
      error: `לא נמצאה כתובת ב-${domain} (נסרקו ${contact.pagesFetched} עמודים) - אפשר להזין ידנית`,
    };
  }

  await db
    .update(supplierLeads)
    .set({ email: contact.primaryEmail })
    .where(eq(supplierLeads.id, leadId));
  revalidatePath(`/projects/${projectId}`);
  return { ok: `${lead.companyName}: ${contact.emails.join(", ")}` };
}

/** Operator types an address the crawler could not reach. */
export async function setLeadEmail(
  _prev: DiscoveryState,
  formData: FormData,
): Promise<DiscoveryState> {
  const leadId = String(formData.get("leadId") ?? "");
  const projectId = String(formData.get("projectId") ?? "");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();

  if (!leadId || !projectId) return { error: "Missing lead" };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { error: "כתובת מייל לא תקינה" };

  await db.update(supplierLeads).set({ email }).where(eq(supplierLeads.id, leadId));
  revalidatePath(`/projects/${projectId}`);
  return { ok: `נשמר ${email}` };
}

/** Retry every lead in the project that is still missing an address. */
export async function refreshMissingEmails(
  _prev: DiscoveryState,
  formData: FormData,
): Promise<DiscoveryState> {
  const projectId = String(formData.get("projectId") ?? "");
  if (!projectId) return { error: "Missing project" };

  const rows = await db
    .select()
    .from(supplierLeads)
    .where(and(eq(supplierLeads.projectId, projectId), isNull(supplierLeads.email)));

  if (rows.length === 0) return { ok: "לכל הלידים כבר יש כתובת" };

  let found = 0;
  for (const lead of rows) {
    if (!lead.website) continue;
    const domain = lead.website.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    const contact = await enrichDomain(domain, { seedUrl: lead.sourceUrl ?? undefined });
    if (!contact.primaryEmail) continue;
    await db
      .update(supplierLeads)
      .set({ email: contact.primaryEmail })
      .where(eq(supplierLeads.id, lead.id));
    found++;
  }

  revalidatePath(`/projects/${projectId}`);
  return { ok: `נמצאו כתובות ל-${found} מתוך ${rows.length}` };
}

/**
 * Approving a lead promotes it into the permanent supplier table; rejecting
 * leaves it as a tombstone so a later discovery run cannot resurrect it.
 */
export async function decideLead(
  _prev: DiscoveryState,
  formData: FormData,
): Promise<DiscoveryState> {
  const leadId = String(formData.get("leadId") ?? "");
  const projectId = String(formData.get("projectId") ?? "");
  const decision = String(formData.get("decision") ?? "");

  if (!leadId || !projectId) return { error: "Missing lead" };
  if (decision !== "approved" && decision !== "rejected") return { error: "Invalid decision" };

  const [lead] = await db.select().from(supplierLeads).where(eq(supplierLeads.id, leadId));
  if (!lead) return { error: "Lead not found" };

  if (decision === "rejected") {
    await db
      .update(supplierLeads)
      .set({ status: "rejected", decidedAt: new Date() })
      .where(eq(supplierLeads.id, leadId));
    revalidatePath(`/projects/${projectId}`);
    return { ok: `${lead.companyName} נדחה` };
  }

  if (!lead.email) {
    return { error: `אין כתובת מייל ל-${lead.companyName} — אי אפשר לאשר לשליחה` };
  }

  await db.transaction(async (tx) => {
    // The supplier database accrues across projects; an address seen before is
    // the same company, so reuse the row rather than creating a duplicate.
    const [existing] = await tx
      .select()
      .from(suppliers)
      .where(eq(suppliers.email, lead.email as string))
      .limit(1);

    const supplierId =
      existing?.id ??
      (
        await tx
          .insert(suppliers)
          .values({
            companyName: lead.companyName,
            website: lead.website,
            email: lead.email,
            companyAddress: lead.country,
            primaryChannel: "email",
            firstSeenProjectId: projectId,
          })
          .returning({ id: suppliers.id })
      )[0]?.id;

    await tx
      .update(supplierLeads)
      .set({ status: "approved", supplierId, decidedAt: new Date() })
      .where(eq(supplierLeads.id, leadId));
  });

  revalidatePath(`/projects/${projectId}`);
  return { ok: `${lead.companyName} אושר` };
}

/** Approve every pending lead that has an email and clears the score bar. */
export async function approveAllAbove(
  _prev: DiscoveryState,
  formData: FormData,
): Promise<DiscoveryState> {
  const projectId = String(formData.get("projectId") ?? "");
  const threshold = Number(formData.get("threshold") ?? 50);
  if (!projectId) return { error: "Missing project" };

  const pending = await db
    .select()
    .from(supplierLeads)
    .where(and(eq(supplierLeads.projectId, projectId), eq(supplierLeads.status, "pending")));

  const eligible = pending.filter((l) => l.email && (l.matchScore ?? 0) >= threshold);
  if (eligible.length === 0) return { error: `אין לידים עם מייל וציון ${threshold} ומעלה` };

  for (const lead of eligible) {
    const data = new FormData();
    data.set("leadId", lead.id);
    data.set("projectId", projectId);
    data.set("decision", "approved");
    await decideLead({}, data);
  }

  revalidatePath(`/projects/${projectId}`);
  return { ok: `${eligible.length} ספקים אושרו` };
}
