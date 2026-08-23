/**
 * Everything waiting on a person, in one list.
 *
 * There used to be two queues and they behaved differently: questions a
 * supplier had asked appeared in a queue, while the numbers the commercial
 * model still needed only surfaced as a red line on a panel further down the
 * page and as a reason the send button would not light. Same situation - the
 * system cannot continue until someone answers - so it belongs in one place.
 *
 * Commercial gaps are derived rather than stored. A stored row would have to be
 * cleaned up whenever the field was filled in somewhere else, and the first
 * time that failed the operator would be looking at a question that was already
 * answered.
 */
import { asc, eq } from "drizzle-orm";
import { db, items, openQuestions, projects, suppliers } from "./db";
import { num } from "./pricing/landed";
import { projectPricing } from "./pricing/project";

export type QuestionKind = "supplier" | "commercial";

export interface PendingQuestion {
  id: string;
  kind: QuestionKind;
  /** Who is blocked. Null for a project-wide fact. */
  company: string | null;
  scope: "project" | "supplier";
  questionHe: string;
  whyHe: string | null;
  /** Commercial questions only: which field the answer writes to. */
  field?: "targetRetailUsd" | "fbaFeeUsd" | "assumedCbmPerUnit";
  itemId?: string;
  /** Commercial questions only: a hint about the shape of the answer. */
  unit?: string;
}

export interface AnsweredQuestion {
  id: string;
  questionHe: string;
  answer: string;
}

/**
 * There are no commercial questions any more.
 *
 * The queue used to ask for retail price, fulfilment fee and packed volume so a
 * ceiling could be derived. The target price in the RFQ already carries that
 * analysis, so the questions were asking the operator to redo work they had
 * done before the document was written. What remains is what a supplier asked
 * and nobody has decided.
 */
async function commercialQuestions(_projectId: string): Promise<PendingQuestion[]> {
  return [];
}

/**
 * The whole queue: what a supplier asked, and what the model still needs.
 *
 * Commercial gaps come first. A supplier question blocks one conversation; a
 * missing selling price blocks the entire round, including the decision about
 * whether the product is worth sourcing at all.
 */
export async function pendingQuestions(projectId: string): Promise<{
  open: PendingQuestion[];
  answered: AnsweredQuestion[];
}> {
  const [commercial, stored] = await Promise.all([
    commercialQuestions(projectId),
    db
      .select({
        id: openQuestions.id,
        company: suppliers.companyName,
        scope: openQuestions.scope,
        questionHe: openQuestions.questionHe,
        whyHe: openQuestions.whyHe,
        status: openQuestions.status,
        answer: openQuestions.answer,
      })
      .from(openQuestions)
      .leftJoin(suppliers, eq(openQuestions.supplierId, suppliers.id))
      .where(eq(openQuestions.projectId, projectId))
      .orderBy(asc(openQuestions.createdAt)),
  ]);

  const supplierQuestions: PendingQuestion[] = stored
    .filter((q) => q.status === "open")
    .map((q) => ({
      id: q.id,
      kind: "supplier" as const,
      company: q.company,
      scope: q.scope,
      questionHe: q.questionHe,
      whyHe: q.whyHe,
    }));

  return {
    open: [...commercial, ...supplierQuestions],
    answered: stored
      .filter((q) => q.status === "answered" && q.answer)
      .map((q) => ({ id: q.id, questionHe: q.questionHe, answer: q.answer as string })),
  };
}

/** Used by the page header to show the one number that matters. */
export async function questionCount(projectId: string): Promise<number> {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) return 0;
  return (await pendingQuestions(projectId)).open.length;
}
