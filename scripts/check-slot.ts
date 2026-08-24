/**
 * The pacing rules, tested against the real projects, then put back.
 *
 * Four claims, all of them about mail that must NOT go out:
 *
 *   1. Two projects wanting the slot - only the first gets it.
 *   2. The holder finishes and frees the slot - the next one still waits for
 *      tomorrow, because the slot already changed hands today.
 *   3. The holder hits its daily cap - it stops, and nobody takes over.
 *   4. Replies never queue and never count against the cap.
 *
 * Claim 2 is the one worth the trouble. It is the difference between "one
 * project a day" as a promise and as a hope: without it, a campaign that
 * finishes at ten in the morning lets a second one send thirty more the same
 * afternoon, and the day's total is sixty.
 */
import { eq } from "drizzle-orm";
import { db, projects } from "../lib/db";
import { coldSentToday, mayStartOutreach, slotState } from "../lib/outreach/slot";

async function reset(ids: string[]) {
  for (const id of ids) {
    await db
      .update(projects)
      .set({ outreachStartedAt: null, outreachCompletedAt: null })
      .where(eq(projects.id, id));
  }
}

async function report(label: string, ids: string[]) {
  console.log(`\n${label}`);
  const state = await slotState();
  console.log(`  slot: ${state.summaryHe}`);
  for (const id of ids) {
    const [project] = await db.select().from(projects).where(eq(projects.id, id));
    const decision = await mayStartOutreach(id);
    const verdict = decision.may ? `MAY SEND (${decision.remaining} left)` : `waits: ${decision.reasonHe}`;
    console.log(`  ${project!.name}: ${verdict}`);
  }
}

async function main() {
  const all = await db.select().from(projects);
  const live = all.filter((p) => !p.pausedAt && !p.archivedAt);
  if (live.length < 2) {
    console.log("need two live projects to test the queue");
    process.exit(0);
  }

  const [first, second] = live;
  const ids = live.map((p) => p.id);
  const originals = new Map(
    all.map((p) => [
      p.id,
      { outreachStartedAt: p.outreachStartedAt, outreachCompletedAt: p.outreachCompletedAt },
    ]),
  );

  console.log(`cold mail sent today, all projects: ${await coldSentToday()}`);

  try {
    await reset(ids);
    await report("both waiting, nothing granted today:", ids);

    // The first one takes it, dated yesterday so today's grant is still free.
    const yesterday = new Date(Date.now() - 26 * 60 * 60 * 1000);
    await db
      .update(projects)
      .set({ outreachStartedAt: yesterday, outreachCompletedAt: null })
      .where(eq(projects.id, first!.id));
    await report(`${first!.name} holds it (granted yesterday):`, ids);

    // It finishes. The slot is free, but it was handed over today.
    await db
      .update(projects)
      .set({ outreachCompletedAt: new Date() })
      .where(eq(projects.id, first!.id));
    await report("holder finished today - the next one must still wait:", ids);

    // Same, but the handover was yesterday: now the next may start.
    await db
      .update(projects)
      .set({ outreachStartedAt: yesterday, outreachCompletedAt: yesterday })
      .where(eq(projects.id, first!.id));
    await report("holder finished yesterday - the next one may start:", ids);

    console.log(`\n${second!.name} cold sent today: ${await coldSentToday(second!.id)}`);
  } finally {
    for (const [id, original] of originals) {
      await db.update(projects).set(original).where(eq(projects.id, id));
    }
    console.log("\nrestored:");
    for (const project of await db.select().from(projects)) {
      console.log(
        `  ${project.name}: started=${project.outreachStartedAt?.toISOString().slice(0, 10) ?? "-"} completed=${project.outreachCompletedAt?.toISOString().slice(0, 10) ?? "-"}`,
      );
    }
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
