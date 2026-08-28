import { NextResponse } from "next/server";
import { probeCredit } from "@/lib/health/credit";
import { sweepBounces } from "@/lib/inbox/bounces";
import { alertIfNoCredit } from "@/lib/notify/credit-alert";
import { dispatchNotifications } from "@/lib/notify/dispatch";
import { authorised } from "../auth";

/**
 * Announcements, on their own budget.
 *
 * This ran at the end of the main cycle and was the first thing lost when the
 * cycle overran - which is exactly backwards. Reading a mailbox that is one
 * cycle behind costs two hours; an alert that never arrives costs the entire
 * premise of a project you are not watching.
 *
 * So it gets its own route. It is cheap - a status pass and at most one mail
 * per project - and it depends on nothing the cycle did in the same call: it
 * reads the state as it stands, whenever it is asked.
 */
export const maxDuration = 120;
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!authorised(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  /*
   * Bounces are swept here rather than in the main cycle for the same reason
   * the announcements are: it is cheap, it is global rather than per project,
   * and it must not be the thing that gets dropped when the cycle overruns. A
   * dead address that stays in the list is written to again on the next round.
   */
  let bounces: unknown = null;
  try {
    const sweep = await sweepBounces();
    bounces = { found: sweep.found.length, cleared: sweep.cleared };
  } catch (err) {
    bounces = { error: err instanceof Error ? err.message : String(err) };
  }

  /*
   * The credit check belongs here for the same reasons the bounce sweep does,
   * and one more: this route is the only one that still works when the balance
   * is empty. It calls no model - the alert goes over Gmail - so it can report
   * a fault that silences everything else.
   *
   * probeCredit spends one token at most once a day while the balance is
   * healthy, and retries every cycle while it is not, because what is being
   * waited for then is recovery.
   */
  let credit: unknown = null;
  try {
    const status = await probeCredit();
    const alert = await alertIfNoCredit();
    credit = { ok: status.ok, checkedAt: status.checkedAt, alerted: alert.alerted };
  } catch (err) {
    credit = { error: err instanceof Error ? err.message : String(err) };
  }

  const sent = await dispatchNotifications();

  return NextResponse.json({
    credit,
    bounces,
    sent: sent.map(({ project, kind, subject, keys }) => ({
      project,
      kind,
      subject,
      items: keys.length,
    })),
  });
}
