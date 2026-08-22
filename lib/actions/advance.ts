"use server";

import { asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, items, projects, requirements, supplierLeads } from "../db";
import { runDiscovery } from "../discovery/run";
import { buildOutreachEmail } from "../outreach/template";
import { getSettings } from "../settings";
import { approveAllAbove } from "./discovery";
import { parseProjectRfq } from "./rfq";

/**
 * Carry a new project as far as it can go without a person.
 *
 * Uploading the RFQ used to be the start of the operator's work rather than the
 * end of it: parse, then generate the email, then run discovery, three buttons
 * in three places, each waiting to be found. Everything in that chain is
 * derived from the document, so none of it was ever a decision - it was just
 * work sitting in front of the first real question.
 *
 * One step per call, so the page can show what is happening instead of hanging
 * on a single request that takes three minutes. The caller loops until `done`.
 */

export type Step = "parse" | "email" | "discover";

export interface AdvanceState {
  /** What this call did, in Hebrew. */
  did?: string;
  error?: string;
  /** Nothing left that can run unattended. */
  done: boolean;
  /** What the next call will do, for the progress line. */
  next?: string;
}

const LABEL: Record<Step, string> = {
  parse: "קורא את ה-RFQ",
  email: "מנסח את מייל הפנייה",
  discover: "מחפש ספקים",
};

/** The first step that has not happened yet. */
async function nextStep(projectId: string): Promise<Step | null> {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) return null;

  const parsed = await db
    .select({ id: items.id })
    .from(items)
    .where(eq(items.projectId, projectId))
    .limit(1);

  if (parsed.length === 0) return project.sourceRfqFile ? "parse" : null;
  if (!project.outreachBody) return "email";

  const leads = await db
    .select({ id: supplierLeads.id })
    .from(supplierLeads)
    .where(eq(supplierLeads.projectId, projectId));

  // Searching again with the same keywords returns the same companies, so one
  // short pass is not a reason to keep trying - the broadening happens inside
  // runDiscovery, and it has already tried every angle it has.
  if (leads.length === 0) return "discover";
  return null;
}

export async function advanceProject(
  _prev: AdvanceState,
  formData: FormData,
): Promise<AdvanceState> {
  const projectId = String(formData.get("projectId") ?? "");
  if (!projectId) return { error: "Missing project", done: true };

  const step = await nextStep(projectId);
  if (!step) return { done: true };

  try {
    if (step === "parse") {
      const data = new FormData();
      data.set("projectId", projectId);
      const result = await parseProjectRfq({}, data);
      if (result.error) return { error: result.error, done: true };
    }

    if (step === "email") {
      const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
      if (!project) return { error: "Project not found", done: true };

      const [projectItems, projectRequirements, settings] = await Promise.all([
        db.select().from(items).where(eq(items.projectId, projectId)).orderBy(asc(items.name)),
        db.select().from(requirements).where(eq(requirements.projectId, projectId)),
        getSettings(),
      ]);

      const { subject, body } = buildOutreachEmail(project, projectItems, projectRequirements, {
        name: settings.senderName,
        title: settings.senderTitle,
      });

      await db
        .update(projects)
        .set({ outreachSubject: subject, outreachBody: body })
        .where(eq(projects.id, projectId));
    }

    if (step === "discover") {
      await runDiscovery(projectId);

      /*
       * On an autonomous project, approving is not a decision the operator was
       * asked to make - they made it when they turned autonomy on. Leaving
       * thirty leads pending would stop the chain one step before the point.
       * Only leads with an address and a score worth writing to.
       */
      const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
      if (project && project.autonomyTier >= 3) {
        const data = new FormData();
        data.set("projectId", projectId);
        data.set("threshold", "30");
        await approveAllAbove({}, data);
      }
    }

    revalidatePath(`/projects/${projectId}`);
    const following = await nextStep(projectId);

    return {
      did: LABEL[step],
      done: following === null,
      next: following ? LABEL[following] : undefined,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : `${LABEL[step]} נכשל`, done: true };
  }
}
