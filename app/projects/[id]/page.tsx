import { OutreachEmail } from "./OutreachEmail";
import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, desc, eq } from "drizzle-orm";
import { db, files, items, projects, requirements, rfqValidationIssues, supplierLeads, suppliers } from "@/lib/db";
import { EditDetails, ParseRfq, UploadRfq } from "./ProjectSettings";
import { Guide } from "@/app/Guide";
import { Suppliers } from "./Suppliers";
import { Campaign } from "./Campaign";
import { Conversations, type SupplierThread } from "./Conversations";
import { Commercials } from "./Commercials";
import { OpenQuestions } from "./OpenQuestions";
import { SideNav, type NavSection } from "./SideNav";
import { campaignStatus } from "@/lib/outreach/batch";
import { projectPricing } from "@/lib/pricing/project";
import { conversations } from "@/lib/inbox/run";
import { pendingQuestions } from "@/lib/questions";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [project] = await db.select().from(projects).where(eq(projects.id, id));
  if (!project) notFound();

  const [projectItems, projectRequirements, projectFiles, issues, leads] = await Promise.all([
    db.select().from(items).where(eq(items.projectId, id)).orderBy(asc(items.name)),
    db.select().from(requirements).where(eq(requirements.projectId, id)),
    db
      .select({
        id: files.id,
        filename: files.filename,
        sizeBytes: files.sizeBytes,
        kind: files.kind,
      })
      .from(files)
      .where(eq(files.projectId, id)),
    db
      .select()
      .from(rfqValidationIssues)
      .where(eq(rfqValidationIssues.projectId, id))
      .orderBy(asc(rfqValidationIssues.severity)),
    db
      .select()
      .from(supplierLeads)
      .where(eq(supplierLeads.projectId, id))
      .orderBy(desc(supplierLeads.matchScore)),
  ]);

  const parsed = projectItems.length > 0 || projectRequirements.length > 0;
  const campaign = await campaignStatus(id);
  const pricing = await projectPricing(id);

  const { open, answered } = await pendingQuestions(id);

  // One row per supplier we wrote to, in the order the conversation happened.
  const threads: SupplierThread[] = [];
  const bySupplier = new Map<string, SupplierThread>();
  for (const row of await conversations(id)) {
    if (!row.supplierId) continue;
    let thread = bySupplier.get(row.supplierId);
    if (!thread) {
      thread = {
        supplierId: row.supplierId,
        company: row.company ?? row.supplierEmail ?? "ספק",
        email: row.supplierEmail,
        website: row.website,
        matchScore: leads.find((l) => l.supplierId === row.supplierId)?.matchScore ?? null,
        messages: [],
      };
      bySupplier.set(row.supplierId, thread);
      threads.push(thread);
    }
    thread.messages.push({
      id: row.id,
      direction: row.direction,
      subject: row.subject,
      bodyText: row.bodyText,
      attachments: row.attachments,
      classification: row.classification,
      analysis: row.analysis,
      handledAt: row.handledAt,
      receivedAt: row.receivedAt,
    });
  }

  /*
   * Conversations the autopilot can actually act on. A quotation sitting in an
   * attachment, or a supplier disputing a requirement, is waiting on a person -
   * counting those under a button labelled "reply to N suppliers" promised
   * something the button would then refuse to do.
   */
  const ballWithUs = threads.filter(
    (t) => t.messages[t.messages.length - 1]?.direction === "inbound",
  );
  const heldForHuman = ballWithUs.filter((t) => {
    const last = t.messages[t.messages.length - 1];
    return (
      last?.analysis?.challenges_a_requirement === true || last?.classification === "quotation"
    );
  });
  const awaitingReply = ballWithUs.length - heldForHuman.length;

  const repliedCount = threads.filter((t) =>
    t.messages.some((m) => m.direction === "inbound"),
  ).length;

  const navSections: NavSection[] = [
    { id: "questions", label: "מה מחכה לך", count: open.length, urgent: open.length > 0 },
    { id: "replies", label: "תשובות מספקים", count: repliedCount },
    { id: "suppliers", label: "ספקים", count: leads.length },
    { id: "send", label: "שליחה", count: campaign.pending.length },
    { id: "model", label: "מודל כלכלי", dimmed: !pricing.ready },
    { id: "rfq", label: "RFQ" },
    { id: "issues", label: "תקלות ב-RFQ", count: issues.length, dimmed: issues.length === 0 },
    { id: "items", label: "פריטים", count: projectItems.length, dimmed: !parsed },
    { id: "email", label: "מייל הפנייה" },
    { id: "details", label: "הגדרות פרויקט" },
  ];

  return (
    <div className="project-layout">
      <SideNav sections={navSections} />
      <main className="stack">
      <div className="spread">
        <div>
          <h2 style={{ margin: 0 }}>{project.name}</h2>
          <div className="muted">
            {project.keywords.join(" · ")}
            {project.quantityTiers.length > 0 && ` — ${project.quantityTiers.join(" / ")} sets`}
          </div>
        </div>
        <span className="tag">{project.status}</span>
      </div>

      <section id="questions" className="card stack">
        <h2>
          מה מחכה לך{" "}
          {open.length > 0 && <span className="bad" style={{ fontSize: 14 }}>({open.length})</span>}
        </h2>
        <Guide k="openQuestions" />
        <OpenQuestions
          projectId={project.id}
          questions={open}
          answered={answered}
          awaitingReply={awaitingReply}
          heldForHuman={heldForHuman.map((t) => ({
            company: t.company,
            reason:
              t.messages[t.messages.length - 1]?.analysis?.needs_human_reason ?? "דורש החלטה שלך",
          }))}
        />
      </section>

      <section id="details" className="card stack">
        <div className="spread">
          <h2 style={{ margin: 0 }}>Details</h2>
        </div>
        <EditDetails
          projectId={project.id}
          name={project.name}
          keywords={project.keywords}
        />
      </section>

      <section id="rfq" className="card stack">
        <h2>RFQ</h2>
        {projectFiles.length === 0 ? (
          <p className="muted" dir="rtl">
            עדיין לא הועלה RFQ. כל המפרט, מחירי המטרה ומדרגות הכמות נקראים ממנו - אפשר להתחיל
            חיפוש בלעדיו, אבל אי אפשר לשלוח.
          </p>
        ) : (
          <ul className="list">
            {projectFiles.map((f) => (
              <li key={f.id}>
                <div className="spread">
                  <span>{f.filename}</span>
                  <span className="muted">{Math.round(f.sizeBytes / 1024)} KB</span>
                </div>
              </li>
            ))}
          </ul>
        )}
        {projectFiles.length > 0 && <ParseRfq projectId={project.id} parsed={parsed} />}
        <UploadRfq projectId={project.id} hasRfq={projectFiles.length > 0} />
      </section>

      {issues.length > 0 && (
        <section id="issues" className="card stack">
          <details>
            <summary>
              <h2 style={{ display: "inline", fontSize: 16 }}>
                תקלות ב-RFQ <span className="muted">({issues.length})</span>
              </h2>
            </summary>
            <Guide k="rfqIssues" />
          <ul className="list">
            {issues.map((v) => (
              <li key={v.id}>
                <div className="spread">
                  <code style={{ fontSize: 12.5 }}>{v.code.replace(/_/g, " ")}</code>
                  <span className={v.severity === "error" ? "bad" : "muted"}>
                    {v.severity}
                  </span>
                </div>
                <div className="muted" style={{ marginTop: 4 }}>
                  {v.detail}
                </div>
              </li>
            ))}
            </ul>
          </details>
        </section>
      )}

      {parsed && (
        <section id="items" className="card stack">
          <details>
            <summary>
              <h2 style={{ display: "inline", fontSize: 16 }}>
                פריטים ומפרט <span className="muted">({projectItems.length})</span>
              </h2>
            </summary>
            <ul className="list">
            {projectItems.map((item) => (
              <li key={item.id}>
                <div className="spread">
                  <strong>{item.name}</strong>
                  <span className="tag">{item.kind.replace(/_/g, " ")}</span>
                </div>
                <div className="muted">
                  {item.targetPrices.length > 0
                    ? item.targetPrices
                        .map((p) => `${p.qty ?? "—"}: $${p.unit_price ?? "?"}`)
                        .join("  ·  ")
                    : "No target price in the RFQ"}
                </div>
              </li>
            ))}
          </ul>
            <p className="muted">
              {projectRequirements.length} requirement
              {projectRequirements.length === 1 ? "" : "s"} extracted ·{" "}
              {projectRequirements.filter((r) => r.isMandatory).length} mandatory
            </p>
            <Guide k="items" />
          </details>
        </section>
      )}

      <section id="model" className="card stack">
        <details open={pricing.ready}>
          <summary>
            <h2 style={{ display: "inline", fontSize: 16 }}>
              מודל כלכלי{" "}
              {pricing.ready ? (
                <span className="muted">
                  walk-away{" "}
                  {pricing.products
                    .filter((p) => p.tiers.length > 0)
                    .map((p) => `$${p.tiers[p.tiers.length - 1]!.walkAwayFob.toFixed(2)}`)
                    .join(" · ")}
                </span>
              ) : (
                <span className="bad" style={{ fontSize: 14 }}>חסרים נתונים</span>
              )}
            </h2>
          </summary>
          <Guide k="commercials" />
        <Commercials
          projectId={project.id}
          targetRoi={pricing.commercial.targetRoi ?? null}
          ppcPct={pricing.commercial.ppcPct ?? null}
          roiAfterPpc={pricing.commercial.roiAfterPpc ?? true}
          referralPct={pricing.commercial.referralPct ?? null}
          hsCode={pricing.hsCode}
          dutyRatePct={pricing.commercial.dutyRatePct ?? null}
          freightUsdPerCbm={pricing.commercial.freightUsdPerCbm ?? null}
          inboundUsdPerUnit={pricing.commercial.inboundUsdPerUnit ?? null}
          products={pricing.products.map((p) => ({
            itemId: p.itemId,
            name: p.name,
            rfqTargetFob: p.rfqTargetFob,
            targetRetailUsd: p.product.targetRetailUsd ?? null,
            fbaFeeUsd: p.product.fbaFeeUsd ?? null,
            cbmPerUnit: p.product.cbmPerUnit ?? null,
            missing: p.readiness.missing,
            verdict: p.verdict
              ? {
                  netRevenue: p.verdict.netRevenue,
                  maxLanded: p.verdict.maxLanded,
                  walkAwayFob: p.verdict.walkAwayFob,
                }
              : null,
          }))}
        />
        </details>
      </section>

      <section id="email" className="card stack">
        <details>
          <summary>
            <h2 style={{ display: "inline", fontSize: 16 }}>מייל הפנייה</h2>
          </summary>
          <Guide k="outreachEmail" />
        <OutreachEmail
          projectId={project.id}
          subject={project.outreachSubject}
          body={project.outreachBody}
          canGenerate={parsed}
        />
        </details>
      </section>

      <section id="suppliers" className="card stack">
        <h2>Suppliers</h2>
        <Guide k="suppliers" />
        <Suppliers projectId={project.id} leads={leads} />
      </section>

      <section id="send" className="card stack">
        <h2>
          Send <span className="muted">({campaign.pending.length})</span>
        </h2>
        <Guide k="campaign" />
        <Campaign
          projectId={project.id}
          pending={campaign.pending.map((r) => ({
            companyName: r.companyName,
            email: r.email,
            matchScore: r.matchScore,
          }))}
          blocked={campaign.blocked}
          sent={campaign.sent}
          failed={campaign.failed}
          hasAttachment={projectFiles.some((f) => f.kind === "rfq")}
          hasEmail={Boolean(project.outreachSubject && project.outreachBody)}
          missingCommercials={pricing.ready ? [] : pricing.missing}
        />
      </section>


      <section id="replies" className="card stack">
        <h2>Replies</h2>
        <Guide k="replies" />
        <Conversations projectId={project.id} threads={threads} />
      </section>

      <Link href="/" className="muted">
        ← All projects
      </Link>
      </main>
    </div>
  );
}
