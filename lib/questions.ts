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

const COMMERCIAL_PROMPTS: Record<
  NonNullable<PendingQuestion["field"]>,
  { question: (name: string) => string; why: string; unit: string }
> = {
  targetRetailUsd: {
    question: (name) => `באיזה מחיר תמכרו את ${name} באמזון?`,
    why: "בלי מחיר המדף אין דרך לדעת מה מותר לשלם ליצרן. מחיר המטרה ב-RFQ הוא ניחוש עד שיש את המספר הזה - ובפעם הקודמת הוא היה נמוך ב-5.52$ מהתקרה האמיתית.",
    unit: "$",
  },
  fbaFeeUsd: {
    question: (name) => `מה עמלת ה-FBA ליחידה של ${name}?`,
    why: "לפי גודל ומשקל האריזה. יורדת מההכנסה לפני חישוב הרווח, ולכן משפיעה ישירות על מחיר ה-walk-away.",
    unit: "$",
  },
  assumedCbmPerUnit: {
    question: (name) => `מה הנפח המשוער של ${name} באריזה, בקוב ליחידה?`,
    why: "קובע את עלות השילוח, שבמוצר מגושם גדולה ממחיר המוצר עצמו. הערכה גסה מספיקה - מידות הקרטון האמיתיות יגיעו מהצעת המחיר ויחליפו אותה.",
    unit: "CBM",
  },
};

/** Commercial inputs the model is still missing, phrased as questions. */
async function commercialQuestions(projectId: string): Promise<PendingQuestion[]> {
  const pricing = await projectPricing(projectId);
  const rows = await db.select().from(items).where(eq(items.projectId, projectId));
  const byId = new Map(rows.map((r) => [r.id, r]));

  const out: PendingQuestion[] = [];

  for (const product of pricing.products) {
    const item = byId.get(product.itemId);
    if (!item) continue;

    const fields: NonNullable<PendingQuestion["field"]>[] = [
      "targetRetailUsd",
      "fbaFeeUsd",
      "assumedCbmPerUnit",
    ];

    for (const field of fields) {
      // Zero counts as unanswered, not as an answer. A retail price of 0 is a
      // field that was written to by accident, and treating it as filled in is
      // how the send gate and this queue ended up disagreeing.
      if (num(item[field])) continue;
      const prompt = COMMERCIAL_PROMPTS[field];
      out.push({
        id: `commercial:${product.itemId}:${field}`,
        kind: "commercial",
        company: null,
        scope: "project",
        questionHe: prompt.question(product.name),
        whyHe: prompt.why,
        field,
        itemId: product.itemId,
        unit: prompt.unit,
      });
    }
  }

  return out;
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
