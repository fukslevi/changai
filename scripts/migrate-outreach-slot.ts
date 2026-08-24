/**
 * The outreach slot, plus a backfill so history is not rewritten.
 *
 * Every project that has already contacted suppliers is marked as having held
 * the slot, dated to when it actually sent. Without that they would all look
 * like they were waiting their turn, and the first cycle after this would treat
 * three finished campaigns as a queue and start one of them over.
 */
import { asc, eq, sql } from "drizzle-orm";
import { db, outreach, projects } from "../lib/db";
import { campaignStatus } from "../lib/outreach/batch";

async function main() {
  await db.execute(
    sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS outreach_started_at timestamptz`,
  );
  await db.execute(
    sql`ALTER TABLE projects ADD COLUMN IF NOT EXISTS outreach_completed_at timestamptz`,
  );
  await db.execute(
    sql`ALTER TABLE settings ADD COLUMN IF NOT EXISTS max_cold_per_day integer NOT NULL DEFAULT 30`,
  );

  for (const project of await db.select().from(projects).orderBy(asc(projects.createdAt))) {
    const sent = await db
      .select({ sentAt: outreach.sentAt })
      .from(outreach)
      .where(eq(outreach.projectId, project.id));

    const stamps = sent.map((s) => s.sentAt).filter((d): d is Date => d !== null);
    if (stamps.length === 0) {
      console.log(`${project.name}: never sent, waiting its turn`);
      continue;
    }

    const first = new Date(Math.min(...stamps.map((d) => d.getTime())));
    const last = new Date(Math.max(...stamps.map((d) => d.getTime())));

    /*
     * Finished means nothing approved is left unsent. A project with recipients
     * still queued keeps the slot, which is right - it has not finished, and
     * handing the slot on while it still has mail to send is the overlap this
     * whole mechanism exists to prevent.
     */
    const status = await campaignStatus(project.id);
    const finished = status.pending.length === 0;

    await db
      .update(projects)
      .set({ outreachStartedAt: first, outreachCompletedAt: finished ? last : null })
      .where(eq(projects.id, project.id));

    console.log(
      `${project.name}: ${stamps.length} sent, ${first.toISOString().slice(0, 10)} → ${last.toISOString().slice(0, 10)}` +
        (finished ? ", finished" : `, still holds the slot (${status.pending.length} queued)`),
    );
  }

  console.log("\noutreach slot ready");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
