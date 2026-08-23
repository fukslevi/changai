import { NextResponse } from "next/server";
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

  const sent = await dispatchNotifications();

  return NextResponse.json({
    sent: sent.map(({ project, kind, subject, keys }) => ({
      project,
      kind,
      subject,
      items: keys.length,
    })),
  });
}
