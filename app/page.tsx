import Link from "next/link";
import { desc } from "drizzle-orm";
import { db, projects } from "@/lib/db";
import {
  ACTIVITY_COLOUR,
  ACTIVITY_LABEL,
  projectStatuses,
} from "@/lib/project-status";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const rows = await db.select().from(projects).orderBy(desc(projects.createdAt));
  const statuses = await projectStatuses(rows);

  const when = (date: Date | null) =>
    date
      ? new Date(date).toLocaleString("he-IL", {
          day: "2-digit",
          month: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        })
      : null;

  return (
    <main className="stack">
      <div className="spread">
        <h2 style={{ margin: 0 }}>Projects</h2>
        <Link href="/projects/new">
          <button>New project</button>
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="empty">
          No projects yet. Create one to upload an RFQ and start sourcing.
        </p>
      ) : (
        <ul className="list">
          {rows.map((p) => (
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
                            status.lastActivity
                              ? `פעילות אחרונה ${when(status.lastActivity)}`
                              : "עוד לא נשלח דבר"
                          }
                        >
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
    </main>
  );
}
