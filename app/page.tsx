import Link from "next/link";
import { desc } from "drizzle-orm";
import { db, projects } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const rows = await db.select().from(projects).orderBy(desc(projects.createdAt));

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
                <span className="tag">{p.status}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
