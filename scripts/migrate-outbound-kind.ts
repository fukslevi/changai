/**
 * Mark outbound messages as replies or chases.
 *
 * Backfilled from the body, because the chase templates are fixed text and the
 * subject prefix that was supposed to identify them never made it onto the
 * message. Without the backfill the five chases already sent would count as
 * zero and each of those suppliers would get a sixth first chase.
 */
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { db, messages } from "../lib/db";

const CHASE_MARKERS = [
  "have not heard back",
  "Following up on my last message",
  "Last note from me",
];

async function main() {
  await db.execute(sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS outbound_kind text`);

  const outbound = await db
    .select({ id: messages.id, bodyText: messages.bodyText })
    .from(messages)
    .where(and(eq(messages.direction, "outbound"), isNull(messages.outboundKind)));

  let chases = 0;
  let replies = 0;

  for (const row of outbound) {
    const isChase = CHASE_MARKERS.some((marker) => (row.bodyText ?? "").includes(marker));
    await db
      .update(messages)
      .set({ outboundKind: isChase ? "chase" : "reply" })
      .where(eq(messages.id, row.id));
    if (isChase) chases++;
    else replies++;
  }

  console.log(`messages.outbound_kind ready · ${chases} chases, ${replies} replies backfilled`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
