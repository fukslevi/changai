/** What the system says it will do next, and when. */
import { asc } from "drizzle-orm";
import { db, projects } from "../lib/db";
import { withinSupplierHours } from "../lib/inbox/autopilot";
import { nextActionsFor, nextCycleAt, nextSupplierWindow } from "../lib/next-action";

function fmt(date: Date | null): string {
  if (!date) return "-";
  const mins = Math.round((date.getTime() - Date.now()) / 60_000);
  const stamp = date.toISOString().slice(0, 16).replace("T", " ");
  return `${stamp}Z (in ${mins < 60 ? `${mins}m` : `${Math.round(mins / 60)}h`})`;
}

async function main() {
  const now = new Date();
  const chinaHour = (now.getUTCHours() + 8) % 24;

  console.log(`now:            ${now.toISOString().slice(0, 16).replace("T", " ")}Z`);
  console.log(`china time:     ${String(chinaHour).padStart(2, "0")}:${String(now.getUTCMinutes()).padStart(2, "0")}`);
  console.log(`reply window:   ${withinSupplierHours(now) ? "OPEN" : "closed"}`);
  console.log(`next cycle:     ${fmt(nextCycleAt(now))}`);
  console.log(`window opens:   ${fmt(nextSupplierWindow(now))}`);

  for (const project of await db.select().from(projects).orderBy(asc(projects.createdAt))) {
    console.log(`\n${project.name}`);
    for (const action of await nextActionsFor(project.id, now)) {
      console.log(`  [${action.kind}] ${action.labelHe}`);
      console.log(`      when: ${fmt(action.at)}`);
      if (action.whyHe) console.log(`      why:  ${action.whyHe}`);
    }
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
