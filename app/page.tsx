import Link from "next/link";
import { desc } from "drizzle-orm";
import { db, projects } from "@/lib/db";
import { CreditBanner } from "./CreditBanner";
import { creditStatus } from "@/lib/health/credit";
import { lastCycleAt } from "@/lib/settings";
import { slotState } from "@/lib/outreach/slot";
import { nextActionsFor, nextCycleAt, nextSupplierWindow } from "@/lib/next-action";
import { projectStats } from "@/lib/project-stats";
import { Stats } from "./Stats";
import { withinSupplierHours } from "@/lib/inbox/autopilot";
import {
  ACTIVITY_COLOUR,
  ACTIVITY_HINT,
  ACTIVITY_LABEL,
  projectStatuses,
} from "@/lib/project-status";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const rows = await db.select().from(projects).orderBy(desc(projects.createdAt));

  /*
   * The archive is a separate list, folded shut.
   *
   * Hiding it entirely would make it a delete with extra steps, and mixing it
   * in would defeat the point of filing something away. A count on a closed
   * fold says it is still there without spending a line on each.
   */
  const live = rows.filter((p) => !p.archivedAt);
  const archived = rows.filter((p) => p.archivedAt);

  const when = (date: Date | null) =>
    date
      ? new Date(date).toLocaleString("he-IL", {
          day: "2-digit",
          month: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        })
      : null;

  const statuses = await projectStatuses(rows);
  const stats = await projectStats(rows.map((r) => r.id));
  const credit = await creditStatus();
  const cycle = await lastCycleAt();
  const slot = await slotState();

  const now = new Date();
  const cycleNext = nextCycleAt(now);
  const replyWindow = nextSupplierWindow(now);
  const replyWindowOpen = withinSupplierHours(now);

  /*
   * The soonest thing each project will do, so a row says whether it is
   * working or waiting without opening it. Silence and a stall look identical
   * from a list, and only one of them needs attention.
   */
  const upcoming = new Map(
    await Promise.all(
      live.map(async (p) => [p.id, (await nextActionsFor(p.id, now))[0] ?? null] as const),
    ),
  );

  const soon = (date: Date) => {
    const minutes = Math.round((date.getTime() - now.getTime()) / 60_000);
    if (minutes <= 1) return "עכשיו";
    if (minutes < 60) return `בעוד ${minutes} דקות`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `בעוד כ-${hours} שעות`;
    return when(date) ?? "";
  };



  return (
    <main className="stack">
      {/*
        Above everything, because it governs whether anything below it means
        anything. Every funnel number on this page was produced by a model call,
        and when the balance is empty those numbers stop moving while continuing
        to look correct.
      */}
      <CreditBanner status={credit} />

      <div className="spread">
        <div>
          <h2 style={{ margin: 0 }}>Projects</h2>
          {/* Proof the loop is alive. A quiet system and a dead one look the
              same until something says when it last ran. */}
          <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }} dir="rtl">
            {cycle
              ? `המחזור האוטומטי רץ לאחרונה ${when(cycle)}`
              : "המחזור האוטומטי עוד לא רץ"}
          </div>
          {/*
            Who is sending, and who is next.

            Without this line a queued project looks broken: it has approved
            suppliers, autonomy is on, and nothing goes out. The reason is
            deliberate and belongs where the waiting is visible.
          */}
          {/*
            When it next runs, not only when it last ran. A system that shows
            only the past leaves the reader to work out whether silence means
            waiting or broken, and those look the same.
          */}
          <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }} dir="rtl">
            המחזור הבא {soon(cycleNext)}
            <span style={{ opacity: 0.7 }}> (בערך - GitHub נוטה לאחר ב-20 דקות)</span>
          </div>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }} dir="rtl">
            {replyWindowOpen
              ? "חלון התשובות לספקים פתוח עכשיו (9:00-18:00 בסין)"
              : replyWindow
                ? `תשובות לספקים ייצאו ${soon(replyWindow)} - כרגע לילה בסין`
                : "חלון התשובות סגור"}
          </div>
          <div
            className="muted"
            style={{ fontSize: 12.5, marginTop: 2, color: "var(--accent)" }}
            dir="rtl"
          >
            {slot.summaryHe}
          </div>
        </div>
        <Link href="/projects/new">
          <button>New project</button>
        </Link>
      </div>

      {live.length === 0 && archived.length === 0 ? (
        <p className="empty">
          No projects yet. Create one to upload an RFQ and start sourcing.
        </p>
      ) : live.length === 0 ? (
        <p className="empty" dir="rtl">
          כל הפרויקטים בארכיון. פתח את הארכיון למטה כדי לשחזר אחד.
        </p>
      ) : (
        <ul className="list">
          {live.map((p) => (
            <li key={p.id}>
              <div className="spread">
                <div>
                  <Link href={`/projects/${p.id}`}>
                    <strong>{p.name}</strong>
                  </Link>
                  <div className="muted">
                    {p.keywords.length} keyword{p.keywords.length === 1 ? "" : "s"}
                    {p.quantityTiers.length > 0 && ` · ${p.quantityTiers.join(" / ")}`}
                    {p.sourceRfqFile && ` · ${p.sourceRfqFile}`}
                  </div>
                  {/*
                    The loudest thing on the row, because it is the only state
                    where every other number is beside the point: leads found,
                    leads approved, autonomy on - and not one email can ever be
                    sent, because there is no document to build one from. It
                    was a line of grey text among four other lines of grey text.
                  */}
                  {!p.sourceRfqFile && (
                    <div
                      dir="rtl"
                      style={{
                        marginTop: 5,
                        padding: "7px 10px",
                        border: "2px solid var(--bad)",
                        borderRadius: "var(--radius)",
                        background: "var(--bad)",
                        color: "#fff",
                        fontSize: 12.5,
                        fontWeight: 700,
                      }}
                    >
                      ● אין מסמך RFQ - לא ייצא אף מייל
                      <div style={{ fontWeight: 400, marginTop: 2, opacity: 0.95 }}>
                        צריך להעלות את הקובץ בעמוד הפרויקט. עד אז הספקים
                        שאושרו ממתינים ולא נשלחת אליהם שום פנייה.
                      </div>
                    </div>
                  )}
                  {slot.queue.find((q) => q.id === p.id) && (
                    <div
                      className="muted"
                      style={{ marginTop: 3, fontSize: 12.5, color: "var(--warn)" }}
                      dir="rtl"
                    >
                      בתור לשליחה · מקום {slot.queue.find((q) => q.id === p.id)?.position} ·{" "}
                      {slot.queue.find((q) => q.id === p.id)?.pending} ספקים
                      {slot.remainingToday === 0 ? " · ממשיך מחר" : ""}
                    </div>
                  )}
                  {stats.get(p.id) && <Stats stats={stats.get(p.id)!} />}
                  {/*
                    One line about what happens next, not two. The row carried
                    both this and the status summary, and they were written by
                    different code answering the same question - which is how
                    "starts tomorrow" and "in about 4 hours" ended up stacked on
                    top of each other.
                  */}
                  {upcoming.get(p.id) ? (
                    <div className="muted" style={{ marginTop: 3, fontSize: 12.5 }} dir="rtl">
                      {upcoming.get(p.id)!.labelHe}
                      {upcoming.get(p.id)!.at && (
                        <strong style={{ color: "var(--accent)" }}>
                          {" "}
                          {soon(upcoming.get(p.id)!.at!)}
                        </strong>
                      )}
                      {upcoming.get(p.id)!.whyHe && (
                        <div className="muted" style={{ fontSize: 12 }}>
                          {upcoming.get(p.id)!.whyHe}
                        </div>
                      )}
                    </div>
                  ) : (
                    statuses.get(p.id)?.nextAction && (
                      <div className="muted" style={{ marginTop: 3, fontSize: 12.5 }} dir="rtl">
                        {statuses.get(p.id)?.nextAction}
                      </div>
                    )
                  )}
                </div>
                <div className="row" style={{ gap: 6 }}>
                  {(() => {
                    const status = statuses.get(p.id);
                    if (!status) return null;
                    return (
                      <>
                        <span
                          className="tag"
                          style={{ color: status.autonomous ? "var(--ok)" : "var(--muted)" }}
                          title={
                            status.autonomous
                              ? "מנהל את ההתכתבות עד הסוף, כולל מיקוח עד התקרה"
                              : "עונה על שאלות עובדתיות; מחיר ומפרט עוצרים אצלך"
                          }
                        >
                          {status.autonomous ? "אוטונומי" : "מלווה"}
                        </span>
                        <span
                          className="tag"
                          style={{ color: ACTIVITY_COLOUR[status.activity] }}
                          title={
                            ACTIVITY_HINT[status.activity] +
                            (status.lastActivity
                              ? ` · פעילות אחרונה ${when(status.lastActivity)}`
                              : "")
                          }
                        >
                          <span
                            className="status-dot"
                            style={{ background: ACTIVITY_COLOUR[status.activity] }}
                          />
                          {ACTIVITY_LABEL[status.activity]}
                          {status.activity === "needs_you" && ` (${status.openQuestions})`}
                          {status.activity === "running" && ` (${status.liveThreads})`}
                        </span>
                      </>
                    );
                  })()}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {archived.length > 0 && (
        <details>
          <summary className="muted" style={{ cursor: "pointer", fontSize: 13 }} dir="rtl">
            ארכיון ({archived.length}) - כבויים, שמורים במלואם, ניתנים לשחזור
          </summary>
          <ul className="list" style={{ marginTop: 8 }}>
            {archived.map((p) => (
              <li key={p.id}>
                <div className="spread">
                  <div>
                    <Link href={`/projects/${p.id}`}>
                      <strong className="muted">{p.name}</strong>
                    </Link>
                    <div className="muted" style={{ fontSize: 12.5 }} dir="rtl">
                      הועבר לארכיון {when(p.archivedAt)}
                    </div>
                  </div>
                  <span className="tag" style={{ color: "var(--muted)" }}>
                    <span className="status-dot" style={{ background: "var(--muted)" }} />
                    בארכיון
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}
    </main>
  );
}
