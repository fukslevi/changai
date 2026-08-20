/**
 * The thing that makes it automatic: a loop that checks the mailbox, triages
 * what came back, and optionally answers.
 *
 *   npx tsx --env-file=.env scripts/watch.ts              # read and triage only
 *   npx tsx --env-file=.env scripts/watch.ts --send       # also reply
 *   npx tsx --env-file=.env scripts/watch.ts --send --every 10
 *
 * Left running, it is the difference between a system that works when someone
 * remembers to open it and one that works. Nothing here is new behaviour - it
 * is the same two functions the buttons call, on a timer.
 *
 * Replies go out only inside Chinese business hours. Not as a disguise: a
 * message that lands at 3am is read late, filtered harder, and answered by
 * nobody. The rest of the cycle - reading, classifying, parking questions -
 * runs around the clock, so the queue is always current when you open it.
 */
import { db, projects } from "../lib/db";
import { runAutopilot, triageAndPark, withinSendingHours, withinSupplierHours } from "../lib/inbox/autopilot";
import { runFollowUps } from "../lib/inbox/followup";
import { runCampaign } from "../lib/outreach/campaign";
import { pollInbox } from "../lib/inbox/run";

const DEFAULT_MINUTES = 15;

function stamp(): string {
  return new Date().toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
}

async function cycle(send: boolean): Promise<void> {
  const all = await db.select().from(projects);

  for (const project of all) {
    try {
      const inbox = await pollInbox(project.id);
      if (inbox.newMessages > 0) {
        console.log(
          `${stamp()}  ${project.name}: ${inbox.newMessages} תשובות חדשות · ` +
            `${inbox.parked} שאלות נפתחו`,
        );
      }
      for (const error of inbox.errors) console.log(`${stamp()}  ! ${error}`);

      // Triage runs even with no new mail: a question answered since the last
      // pass can release a thread that was waiting on it.
      // Replies wait for their working day; first contact only waits for ours.
      const canReply = send && withinSupplierHours();
      const canContact = send && withinSendingHours();
      const result = canReply
        ? await runAutopilot(project.id)
        : await triageAndPark(project.id);

      for (const r of result.replied) console.log(`${stamp()}  → נענה: ${r.company}`);
      for (const r of result.parked) {
        console.log(`${stamp()}  ? ${r.company} מחכה לתשובה שלך: ${r.questions.join(" | ")}`);
      }
      for (const r of result.heldForHuman) {
        console.log(`${stamp()}  ! ${r.company} דורש החלטה: ${r.reason}`);
      }
      // Chasing the silent half is the other half of the job. Without it a
      // thread that never got an answer looks the same as one still in play.
      const chases = await runFollowUps(project.id, { send: canReply });
      for (const c of chases.chased) {
        console.log(`${stamp()}  ↻ תזכורת ${c.attempt} ל-${c.company}`);
      }
      for (const c of chases.closed) console.log(`${stamp()}  × נסגר ללא מענה: ${c.company}`);

      if (canContact) {
        const campaign = await runCampaign(project.id);
        for (const name of campaign.sent) console.log(`${stamp()}  ✉ פנייה ראשונה: ${name}`);
        if (campaign.remaining > 0) {
          console.log(`${stamp()}  ${campaign.remaining} ספקים ממתינים לפנייה`);
        }
      }

      if (send && !withinSupplierHours() && result.readyToSend.length > 0) {
        console.log(
          `${stamp()}  ${result.readyToSend.length} תשובות מוכנות, ממתינות לשעות עבודה בסין`,
        );
      }
    } catch (err) {
      console.log(`${stamp()}  ! ${project.name}: ${err instanceof Error ? err.message : err}`);
    }
  }
}

async function main() {
  const send = process.argv.includes("--send");
  const everyIndex = process.argv.indexOf("--every");
  const minutes =
    everyIndex > -1 ? Number(process.argv[everyIndex + 1]) || DEFAULT_MINUTES : DEFAULT_MINUTES;

  console.log(
    `Watching every ${minutes} min · ${send ? "יענה לספקים בשעות עבודה" : "קריאה וסיווג בלבד"}\n` +
      "Ctrl+C to stop.\n",
  );

  for (;;) {
    await cycle(send);
    await new Promise((resolve) => setTimeout(resolve, minutes * 60_000));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
