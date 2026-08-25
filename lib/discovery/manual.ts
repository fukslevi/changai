import { and, eq, sql } from "drizzle-orm";
import { db, projects, requirements, supplierLeads } from "../db";
import { enrichDomain } from "./enrich";
import { MIN_SCORE_TO_STORE } from "./run";
import { scoreCandidates } from "./score";

export interface AddedSupplier {
  domain: string;
  companyName: string;
  email: string | null;
  matchScore: number | null;
  /** Hebrew, when the site gave us nothing usable. */
  problemHe: string | null;
  alreadyKnown: boolean;
}

export type ManualState = {
  error?: string;
  ok?: string;
  added?: AddedSupplier[];
};

/** Accepts a domain, a URL, or a contact page - anything a person would paste. */
function domainOf(input: string): { domain: string; url: string } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    const domain = url.hostname.replace(/^www\./i, "").toLowerCase();
    if (!domain.includes(".")) return null;
    return { domain, url: url.toString() };
  } catch {
    return null;
  }
}

/**
 * Add suppliers by hand, from URLs.
 *
 * Lives outside the server action so it can be exercised without a request
 * context - the action revalidates paths, and the first version of the test for
 * this proved only that `revalidatePath` throws in a script.
 *
 * Search finds most of them and misses the ones that matter: a factory a
 * colleague met at a fair, a name from a competitor's packaging, a site that
 * ranks nowhere because it was built in 2009 and never touched. Those are often
 * better leads than anything a query returns, and until now there was no way to
 * put one into the system.
 *
 * Deliberately exempt from the discovery target. Thirty is a stopping rule for
 * an automatic search that would otherwise run forever; it is not a reason to
 * refuse a supplier a person went out and found. The daily sending cap still
 * applies - that one protects the mailbox rather than bounding a search.
 */
export async function addSuppliersByUrl(
  _prev: ManualState,
  formData: FormData,
): Promise<ManualState> {
  const projectId = String(formData.get("projectId") ?? "");
  if (!projectId) return { error: "Missing project" };

  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) return { error: "Project not found" };

  const raw = String(formData.get("urls") ?? "");
  const inputs = raw
    .split(/[\s,;]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (inputs.length === 0) return { error: "לא הוזנה אף כתובת" };
  if (inputs.length > 20) return { error: "עד 20 כתובות בכל פעם" };

  const parsed = inputs.map(domainOf);
  const bad = inputs.filter((_, i) => parsed[i] === null);
  if (bad.length > 0) return { error: `כתובת לא תקינה: ${bad.join(", ")}` };

  const targets = [...new Map(parsed.filter((p) => p !== null).map((p) => [p!.domain, p!])).values()];

  const existing = await db
    .select({ domain: supplierLeads.domain, status: supplierLeads.status })
    .from(supplierLeads)
    .where(eq(supplierLeads.projectId, projectId));
  const known = new Map(existing.map((row) => [row.domain, row.status]));

  const projectRequirements = (
    await db
      .select({ text: requirements.text })
      .from(requirements)
      .where(eq(requirements.projectId, projectId))
  ).map((r) => r.text);

  const added: AddedSupplier[] = [];
  const fresh: { domain: string; url: string; companyText: string; email: string | null }[] = [];

  for (const target of targets) {
    if (known.has(target.domain)) {
      added.push({
        domain: target.domain,
        companyName: target.domain,
        email: null,
        matchScore: null,
        problemHe: `כבר ברשימה (${known.get(target.domain)})`,
        alreadyKnown: true,
      });
      continue;
    }

    try {
      const contact = await enrichDomain(target.domain, { seedUrl: target.url });

      /*
       * A site that gave us nothing is not a supplier, it is a typo.
       *
       * Enrichment does not throw on a domain that fails to resolve - it comes
       * back empty - so a mistyped address was being stored as a lead, scored
       * by a model that had nothing to read, and named "Unknown / non-existent".
       * A row like that is worse than an error message: it sits in the list
       * looking like work somebody has to do.
       */
      if (!contact.primaryEmail && contact.companyText.trim().length < 40) {
        added.push({
          domain: target.domain,
          companyName: target.domain,
          email: null,
          matchScore: null,
          problemHe: "לא הצלחנו לקרוא את האתר - בדוק את הכתובת",
          alreadyKnown: false,
        });
        continue;
      }

      fresh.push({
        domain: target.domain,
        url: target.url,
        companyText: contact.companyText,
        email: contact.primaryEmail,
      });
    } catch (err) {
      added.push({
        domain: target.domain,
        companyName: target.domain,
        email: null,
        matchScore: null,
        problemHe: `האתר לא נענה: ${err instanceof Error ? err.message : "שגיאה"}`,
        alreadyKnown: false,
      });
    }
  }

  /*
   * Scored like any other lead. A supplier you found yourself still has to be a
   * manufacturer of this product, and the score is what the page shows next to
   * every other row - leaving it blank would make hand-added rows the only ones
   * nobody can compare.
   */
  const scores =
    fresh.length > 0
      ? await scoreCandidates(
          project.name,
          projectRequirements,
          fresh.map((f) => ({
            domain: f.domain,
            title: f.domain,
            snippet: "",
            matchedQueries: ["added by hand"],
            companyText: f.companyText,
          })),
        )
      : [];

  const scoreByDomain = new Map(scores.map((s) => [s.domain, s]));

  for (const entry of fresh) {
    const score = scoreByDomain.get(entry.domain);
    const companyName = score?.companyName?.trim() || entry.domain;

    /*
     * Your judgement wins, but not silently over a score of three.
     *
     * Pasting a URL is normally the approval - nobody looks up a supplier in
     * order to think about it later. A score this low is the other case: a bike
     * rack factory pasted into a kettlebell project scores 3, and it is far
     * more likely to be the wrong link than a hidden gem. So it is stored and
     * flagged rather than emailed, and one click still sends it.
     */
    const plainlyWrong = (score?.score ?? 0) < MIN_SCORE_TO_STORE;
    const sendable = Boolean(entry.email) && !plainlyWrong;

    await db
      .insert(supplierLeads)
      .values({
        projectId,
        companyName,
        domain: entry.domain,
        website: `https://${entry.domain}`,
        email: entry.email,
        country: score?.country ?? null,
        source: "manual",
        sourceUrl: entry.url,
        matchScore: score ? Math.round(score.score) : null,
        matchRationale: score?.rationale ?? null,
        /*
         * Approved on sight when we have an address. Pasting a URL is the
         * approval - nobody types a supplier's website in order to think about
         * it - and a hand-added lead landing in a pending list to be approved
         * again is the sort of second gate that gets ignored until it is
         * forgotten.
         */
        status: sendable ? "approved" : "pending",
        decidedAt: sendable ? new Date() : null,
      })
      .onConflictDoUpdate({
        target: [supplierLeads.projectId, supplierLeads.domain],
        set: {
          companyName,
          email: entry.email ?? sql`${supplierLeads.email}`,
          website: `https://${entry.domain}`,
          sourceUrl: entry.url,
        },
      });

    added.push({
      domain: entry.domain,
      companyName,
      email: entry.email,
      matchScore: score ? Math.round(score.score) : null,
      problemHe: !entry.email
        ? "לא נמצאה כתובת מייל באתר - אפשר להוסיף אותה ידנית ברשימת הספקים"
        : plainlyWrong
          ? `ציון ${score?.score ?? 0} - האתר לא נראה כמו יצרן של המוצר הזה. נשמר בהמתנה; אם זו הכתובת הנכונה, אשר אותו ברשימת הספקים`
          : null,
      alreadyKnown: false,
    });
  }

  const ready = added.filter((a) => a.email && !a.problemHe && !a.alreadyKnown).length;
  const stuck = added.filter((a) => a.problemHe && !a.alreadyKnown).length;

  return {
    ok:
      ready > 0
        ? `${ready} ספקים נוספו ואושרו לשליחה${stuck > 0 ? `, ${stuck} דורשים טיפול` : ""}. הם יקבלו פנייה בתור של הפרויקט, מעבר למכסת ה-30.`
        : "לא נוסף אף ספק חדש שאפשר לפנות אליו.",
    added,
  };
}

/** Set an address by hand when the site never yielded one. */
export async function setLeadEmail(
  _prev: ManualState,
  formData: FormData,
): Promise<ManualState> {
  const projectId = String(formData.get("projectId") ?? "");
  const leadId = String(formData.get("leadId") ?? "");
  const email = String(formData.get("email") ?? "").trim();

  if (!projectId || !leadId) return { error: "Missing lead" };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "כתובת מייל לא תקינה" };

  await db
    .update(supplierLeads)
    .set({ email, status: "approved", decidedAt: new Date() })
    .where(and(eq(supplierLeads.id, leadId), eq(supplierLeads.projectId, projectId)));

  return { ok: "הכתובת נשמרה והספק אושר לשליחה." };
}
