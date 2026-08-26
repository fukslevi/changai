/**
 * Ask, again, for a number.
 *
 * A factory that replied and never quoted is the most wasted asset in the
 * system. It is reachable, it read the specification, it cared enough to write
 * - and the exchange produced nothing that can go in a comparison. Seventeen of
 * these were sitting across four projects, two of them having said plainly that
 * the target could not be met, which is exactly the case where their own number
 * is worth the most: it is the honest floor for the product, and the suppliers
 * who agreed to everything never reveal it.
 *
 * The reply planner now presses for a price in new conversations. This is for
 * the ones already sitting there, and it keeps running afterwards, because a
 * supplier can always answer without quoting again.
 *
 * It counts as a chase for pacing. Writing to somebody who did not ask to hear
 * from us is exactly what the daily allowance exists to meter, whatever the
 * message says.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { and, asc, eq, gte, isNotNull } from "drizzle-orm";
import {
  db,
  messages,
  projects,
  quoteReadings,
  requirements,
  supplierLeads,
  suppliers,
} from "../db";
import { sendReply } from "./reply";

/** Long enough that a second ask is not nagging. */
const DAYS_BETWEEN_ASKS = 5;

const Draft = z.object({
  /** Plain text, no signature - one is appended when it is sent. */
  body: z.string(),
});

export interface PressCandidate {
  supplierId: string;
  company: string;
  /** They said the target cannot be met. Their floor is the interesting part. */
  refusedTarget: boolean;
  /** What they said about price, in their words. */
  objection: string | null;
  lastHeard: Date;
}

export interface PressResult {
  asked: { company: string; draft: string }[];
  skipped: { company: string; reason: string }[];
  candidates: PressCandidate[];
}

/**
 * Suppliers who answered and never priced.
 *
 * Excludes anyone the operator took over - they made a judgement we cannot see,
 * and a machine writing over the top of it is worse than one that says nothing.
 */
export async function pricelessRepliers(projectId: string): Promise<PressCandidate[]> {
  const inbound = await db
    .select({
      supplierId: messages.supplierId,
      company: suppliers.companyName,
      receivedAt: messages.receivedAt,
    })
    .from(messages)
    .leftJoin(suppliers, eq(messages.supplierId, suppliers.id))
    .where(and(eq(messages.projectId, projectId), eq(messages.direction, "inbound")));

  const repliers = new Map<string, { company: string; last: Date }>();
  for (const row of inbound) {
    if (!row.supplierId) continue;
    const held = repliers.get(row.supplierId);
    if (!held || row.receivedAt > held.last) {
      repliers.set(row.supplierId, { company: row.company ?? "ספק", last: row.receivedAt });
    }
  }

  const readings = await db
    .select()
    .from(quoteReadings)
    .where(eq(quoteReadings.projectId, projectId));

  const priced = new Set(
    readings.filter((r) => r.lines.some((l) => l.unit_price !== null)).map((r) => r.supplierId),
  );

  const objections = new Map<string, string | null>();
  for (const reading of readings) {
    if (reading.rejectsTargetPrice) {
      objections.set(reading.supplierId, reading.priceObjection);
    }
  }

  const takenOver = new Set(
    (
      await db
        .select({ supplierId: supplierLeads.supplierId })
        .from(supplierLeads)
        .where(
          and(eq(supplierLeads.projectId, projectId), isNotNull(supplierLeads.takenOverAt)),
        )
    )
      .map((l) => l.supplierId)
      .filter((id): id is string => id !== null),
  );

  // Anyone asked recently is left alone.
  const since = new Date(Date.now() - DAYS_BETWEEN_ASKS * 86_400_000);
  const recentlyAsked = new Set(
    (
      await db
        .select({ supplierId: messages.supplierId })
        .from(messages)
        .where(
          and(
            eq(messages.projectId, projectId),
            eq(messages.direction, "outbound"),
            eq(messages.outboundKind, "price_ask"),
            gte(messages.receivedAt, since),
          ),
        )
    )
      .map((m) => m.supplierId)
      .filter((id): id is string => id !== null),
  );

  const out: PressCandidate[] = [];
  for (const [supplierId, info] of repliers) {
    if (priced.has(supplierId)) continue;
    if (takenOver.has(supplierId)) continue;
    if (recentlyAsked.has(supplierId)) continue;

    out.push({
      supplierId,
      company: info.company,
      refusedTarget: objections.has(supplierId),
      objection: objections.get(supplierId) ?? null,
      lastHeard: info.last,
    });
  }

  return out.sort((a, b) => b.lastHeard.getTime() - a.lastHeard.getTime());
}

const SYSTEM = `You write one short email to a factory that replied to an enquiry and never
gave a price.

The only goal is a number. Not agreement with our target, not a negotiation -
their own price, at our quantities, whatever it is.

How:
- Accept whatever they said about price rather than disputing it. "Understood"
  beats "are you sure". Arguing first and asking second gets neither.
- Ask for their best price at each quantity, as their own figure. Make it easy
  to answer: a factory that has to work out our position before replying often
  does not reply.
- Give them the reason it is worth their time: we are putting a costed proposal
  in front of our client, and only suppliers with a price in it are considered
  at all. A factory that stays silent is not in the comparison.
- Ask what specification change would bring the cost down - material, finish,
  packaging, a longer lead time. That answer is often where the saving is, and
  it costs nothing to ask.

Do not:
- Invent a quantity, a price, a date or a specification. The quantity tiers are
  given to you exactly; use those figures and no others.
- Restate the specification. They have the RFQ.
- Offer a higher target, hint at flexibility, or name any figure of ours.
- Promise an order, a date, a sample or a volume.
- Apologise for asking again.

Style: plain text, short lines, no markdown, short hyphen (-) never a long dash,
four short paragraphs at most. No greeting line beyond their name, no signature -
one is appended afterwards.`;

async function draftAsk(
  productName: string,
  quantityTiers: number[],
  requirementTexts: string[],
  candidate: PressCandidate,
  conversation: { direction: string; bodyText: string | null }[],
): Promise<string | null> {
  const brief = [
    `PRODUCT: ${productName}`,
    /*
     * The tiers, stated rather than left to be inferred.
     *
     * A draft asked a factory for prices at "500, 1,000 and 2,000 units" when
     * the RFQ says 500 / 1,000 / 1,500. The model had the requirement text and
     * reconstructed the quantities from it, mostly correctly - which is the
     * worst kind of mostly, because the email goes to somebody who will quote
     * against the wrong number.
     */
    `QUANTITY TIERS - use exactly these and no others: ${quantityTiers.join(" / ")}`,
    `SUPPLIER: ${candidate.company}`,
    candidate.refusedTarget
      ? `THEY SAID OUR TARGET CANNOT BE MET: ${candidate.objection ?? "(no wording recorded)"}`
      : "THEY REPLIED BUT NEVER QUOTED.",
    "",
    "KEY REQUIREMENTS:",
    ...requirementTexts.slice(0, 12).map((r) => `- ${r}`),
    "",
    "CONVERSATION SO FAR:",
    ...conversation.slice(-6).map((m) => `[${m.direction}] ${(m.bodyText ?? "").slice(0, 900)}`),
  ].join("\n");

  const stream = new Anthropic().messages.stream({
    model: "claude-opus-5",
    max_tokens: 2000,
    output_config: { effort: "medium", format: zodOutputFormat(Draft) },
    system: SYSTEM,
    messages: [{ role: "user", content: brief }],
  });

  const message = await stream.finalMessage();
  const json = message.content.find((block) => block.type === "text")?.text;
  if (!json) return null;

  try {
    return Draft.parse(JSON.parse(json)).body;
  } catch {
    return null;
  }
}

/**
 * Write to everyone who replied without a price.
 *
 * `limit` and `deadline` are the caller's, because this runs inside a cycle
 * that has other work to do.
 */
export async function pressForPrice(
  projectId: string,
  options: { send?: boolean; limit?: number; deadline?: number } = {},
): Promise<PressResult> {
  const send = options.send ?? true;
  const limit = options.limit ?? 4;

  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  const result: PressResult = { asked: [], skipped: [], candidates: [] };
  if (!project || project.pausedAt || project.archivedAt) return result;

  result.candidates = await pricelessRepliers(projectId);
  if (result.candidates.length === 0) return result;

  const requirementTexts = (
    await db
      .select({ text: requirements.text })
      .from(requirements)
      .where(eq(requirements.projectId, projectId))
  ).map((r) => r.text);

  for (const candidate of result.candidates.slice(0, limit)) {
    if (options.deadline && Date.now() > options.deadline) {
      result.skipped.push({ company: candidate.company, reason: "cycle out of time" });
      continue;
    }

    const conversation = await db
      .select({ direction: messages.direction, bodyText: messages.bodyText })
      .from(messages)
      .where(
        and(eq(messages.projectId, projectId), eq(messages.supplierId, candidate.supplierId)),
      )
      .orderBy(asc(messages.receivedAt));

    const draft = await draftAsk(
      project.name,
      project.quantityTiers,
      requirementTexts,
      candidate,
      conversation,
    );
    if (!draft) {
      result.skipped.push({ company: candidate.company, reason: "הניסוח נכשל" });
      continue;
    }

    if (send) {
      try {
        await sendReply(projectId, candidate.supplierId, draft, { kind: "price_ask" });
      } catch (err) {
        result.skipped.push({
          company: candidate.company,
          reason: err instanceof Error ? err.message : "השליחה נכשלה",
        });
        continue;
      }
    }

    result.asked.push({ company: candidate.company, draft });
  }

  return result;
}
