import { OutreachEmail } from "./OutreachEmail";
import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, desc, eq } from "drizzle-orm";
import { db, files, items, projects, requirements, rfqValidationIssues, supplierLeads, suppliers } from "@/lib/db";
import { EditDetails, ParseRfq, UploadRfq } from "./ProjectSettings";
import { Guide } from "@/app/Guide";
import { Suppliers } from "./Suppliers";
import { AddSuppliers } from "./AddSuppliers";
import { Campaign } from "./Campaign";
import { Conversations, type SupplierThread } from "./Conversations";
import { Commercials } from "./Commercials";
import { OpenQuestions } from "./OpenQuestions";
import { SideNav, type NavSection } from "./SideNav";
import { Autostart } from "./Autostart";
import { Comparison } from "./Comparison";
import { TargetPrice } from "./TargetPrice";
import { PriceAudit } from "./PriceAudit";
import { revisionsFor } from "@/lib/pricing/revise";
import { buildComparison } from "@/lib/quotes/compare";
import { Autonomy } from "./Autonomy";
import { Pause } from "./Pause";
import { NextUp } from "./NextUp";
import { nextActionsFor } from "@/lib/next-action";
import { campaignStatus } from "@/lib/outreach/batch";
import { mayStartOutreach, slotState } from "@/lib/outreach/slot";
import { projectPricing } from "@/lib/pricing/project";
import { conversations } from "@/lib/inbox/run";
import { pendingQuestions } from "@/lib/questions";
import {
  ACTIVITY_COLOUR,
  ACTIVITY_HINT,
  ACTIVITY_LABEL,
  projectStatuses,
} from "@/lib/project-status";
import { ABSOLUTE_LIMITS, loadMandate } from "@/lib/negotiate/mandate";

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
  const mandate = await loadMandate(id);
  const comparison = await buildComparison(id);
  const revisions = await revisionsFor(id);
  const slot = await slotState();
  const outreachTurn = await mayStartOutreach(id);
  const now = new Date();
  const nextUp = await nextActionsFor(id, now);

  const { open, answered } = await pendingQuestions(id);
  // Same source as the list page, so the two views can never disagree about
  // whether a project is running.
  const status = (await projectStatuses([project])).get(project.id);

  /*
   * Setup that can still run unattended. An RFQ that has not been read, an
   * email that has not been written, a search that has not run - all derived
   * from the document, none of them a decision, so the page starts them itself.
   */
  const setupPending =
    Boolean(project.sourceRfqFile) &&
    (projectItems.length === 0 || !project.outreachBody || leads.length === 0);

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
        takenOver: Boolean(leads.find((l) => l.supplierId === row.supplierId)?.takenOverAt),
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
    (t) => t.messages[t.messages.length - 1]?.direction === "inbound" && !t.takenOver,
  );
  /*
   * The same rule the autopilot uses, mandate included. The page had its own
   * copy that predated autonomy, so a quotation showed as "only you can answer"
   * on a project where the agent was already authorised to answer it - two
   * rules for one decision, and the visible one was the wrong one.
   */
  const heldForHuman = mandate.mayNegotiatePrice
    ? []
    : ballWithUs.filter((t) => {
        const last = t.messages[t.messages.length - 1];
        return (
          last?.analysis?.challenges_a_requirement === true ||
          last?.classification === "quotation"
        );
      });
  const awaitingReply = ballWithUs.length - heldForHuman.length;

  const repliedCount = threads.filter((t) =>
    t.messages.some((m) => m.direction === "inbound"),
  ).length;

  /*
   * Taking over one conversation does not take over the project.
   *
   * The flag lives on the supplier row, scoped to this project and this
   * factory, so the other ten threads carry on under the same mandate as
   * before. That is the intent, and it is worth saying on the page - a system
   * that silently stopped everything because you answered one email once would
   * look identical from here.
   */
  const takenOverCount = threads.filter((t) => t.takenOver).length;

  const navSections: NavSection[] = [
    { id: "step-quotes", label: "הצעות מחיר", count: comparison.suppliers.length },
    { id: "step-inbox", label: "מה מחכה לך", count: open.length, urgent: open.length > 0 },
    { id: "step-talks", label: "שיחות עם ספקים", count: repliedCount },
    { id: "step-suppliers", label: "ספקים", count: leads.length },
    { id: "step-product", label: "המוצר", dimmed: !parsed },
    { id: "step-settings", label: "הגדרות" },
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
        <div className="stack" style={{ gap: 4, alignItems: "flex-end" }}>
          <div className="row" style={{ gap: 6 }}>
          {project.archivedAt ? (
            <span className="tag" style={{ color: "var(--muted)" }}>
              <span className="status-dot" style={{ background: "var(--muted)" }} />
              בארכיון
            </span>
          ) : (
            project.pausedAt && (
              <span className="tag" style={{ color: "var(--bad)" }}>
                <span className="status-dot" style={{ background: "var(--bad)" }} />
                כבוי
              </span>
            )
          )}
          {status && (
            <>
              <span
                className="tag"
                style={{ color: status.autonomous ? "var(--ok)" : "var(--muted)" }}
                title={
                  status.autonomous
                    ? "הסוכן מנהל את המשא ומתן לבד, כולל מחיר, עד התקרה"
                    : "כל החלטה מסחרית עוברת דרכך"
                }
              >
                {status.autonomous ? "אוטונומי" : "מלווה"}
              </span>
              <span
                className="tag"
                style={{ color: ACTIVITY_COLOUR[status.activity] }}
                title={ACTIVITY_HINT[status.activity]}
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
          )}
          </div>
          {project.archivedAt ? (
            <span className="muted" style={{ fontSize: 12.5 }} dir="rtl">
              בארכיון וכבוי - שום דבר לא רץ. שחזור מחזיר אותו לרשימה, עדיין כבוי
            </span>
          ) : project.pausedAt ? (
            <span className="muted" style={{ fontSize: 12.5 }} dir="rtl">
              כבוי - לא נשלחות פניות, לא נקראות תשובות ולא נשלחות תזכורות
            </span>
          ) : (
            status?.nextAction && (
              <span className="muted" style={{ fontSize: 12.5 }} dir="rtl">
                {status.nextAction}
              </span>
            )
          )}
          {!project.pausedAt && !project.archivedAt && !outreachTurn.may && (
            <span
              className="muted"
              style={{ fontSize: 12.5, color: "var(--warn)" }}
              dir="rtl"
              title="פרויקט אחד שולח פניות קרות בכל פעם, והתור מתחלף לכל היותר פעם ביום. תשובות לספקים אף פעם לא ממתינות."
            >
              שליחה: {outreachTurn.reasonHe}
            </span>
          )}
          {!project.pausedAt && !project.archivedAt && outreachTurn.may && slot.holderId === id && (
            <span className="muted" style={{ fontSize: 12.5, color: "var(--ok)" }} dir="rtl">
              שולח עכשיו · {slot.sentToday}/{slot.maxPerDay} פניות היום
            </span>
          )}
          {takenOverCount > 0 && (
            <span className="muted" style={{ fontSize: 12.5 }} dir="rtl">
              {takenOverCount} שיחות שלקחת לעצמך - הפרויקט עצמו נשאר{" "}
              {status?.autonomous ? "אוטונומי" : "מלווה"} לכל השאר
            </span>
          )}
          <Pause
            projectId={project.id}
            pausedAt={project.pausedAt}
            archivedAt={project.archivedAt}
          />
        </div>
      </div>









      
      











      {/*
        Five steps, in the order the work happens.
        
        There were eleven sections and a rail with eleven entries, which is an
        accurate map of the system and a poor description of the job. Grouping
        them hides nothing - every sub-part is still here - but it answers the
        question an operator opens the page with, which is "what stage is this
        at" rather than "which of eleven panels did I want".
      */}
      <Autostart projectId={project.id} pending={setupPending} />

      {/*
        A project with no RFQ document cannot send anything, and until now said
        so nowhere. Electric Lunch Box sat with 45 leads and 32 of them approved
        - every number on the page rising - while the one thing that turns a
        lead into an email had never been uploaded. The setup banner above does
        not cover it, because it only runs once a document exists.
      */}
      {!project.sourceRfqFile && (
        <section
          className="card stack"
          dir="rtl"
          style={{
            gap: 6,
            border: "2px solid var(--bad)",
            background: "var(--bad)",
            color: "#fff",
          }}
        >
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>
            ● לא הועלה מסמך RFQ - לא ייצא אף מייל
          </h2>
          <p style={{ margin: 0, fontSize: 13.5 }}>
            בלי המסמך אי אפשר לייצר את מייל הפנייה, ולכן לא יישלח דבר - גם אם
            נמצאו ספקים והם אושרו. חיפוש הספקים ממשיך לרוץ ברקע, אבל התור לא
            יתקדם עד שהקובץ יעלה.
          </p>
          <p style={{ margin: 0, fontSize: 13.5 }}>
            העלה את קובץ ה-RFQ באזור הקבצים למטה. מיד לאחר מכן המערכת תפרק אותו
            לפריטים, תכתוב את המייל ותתחיל לפנות לספקים המאושרים.
          </p>
        </section>
      )}

      {/*
        Above the table, because it answers the question asked on arrival.
        "Last reply 7 hours ago" reads as broken; "replying to 3 suppliers in
        about 6 hours, because it is 2am in China" reads as working.
      */}
      <section className="card stack" style={{ gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 16 }} dir="rtl">
          מה קורה עכשיו
        </h2>
        <NextUp actions={nextUp} now={now} />
      </section>

      {/*
        The table first.
        
        It used to be third, behind the queue and the conversation log, which is
        the order the work happens in rather than the order it is read in. The
        question anyone opens a sourcing project with is "how close are we", and
        that is one table - everything below it explains how the numbers got
        there, which is only interesting once you have seen them.
      */}
      <section id="step-quotes" className="card stack">
        <h2>
          1 · הצעות מחיר{" "}
          <span className="muted" style={{ fontSize: 14 }}>
            ({comparison.suppliers.length})
          </span>
        </h2>
        <Guide k="comparison" />
        <Comparison
          data={comparison}
          latestRevision={revisions.length > 0 ? revisions[revisions.length - 1] : null}
        />

        <details open={comparison.suppliers.length > 0 && comparison.refusals > 0}>
          <summary>
            <h2 style={{ display: "inline", fontSize: 16 }}>
              מחיר מטרה{" "}
              {revisions.length > 0 && (
                <span className="muted">({revisions.length} עדכונים)</span>
              )}
            </h2>
          </summary>
          <Guide k="targetPrice" />
          <TargetPrice
            projectId={project.id}
            items={projectItems
              .filter((item) => item.kind === "priced_variant")
              .map((item) => ({
                id: item.id,
                name: item.name,
                targets: item.targetPrices.map((p) => ({
                  qty: p.qty,
                  unitPrice: p.unit_price,
                })),
              }))}
            revisions={revisions.map((r) => ({
              itemName: r.itemName,
              qty: r.qty,
              previousUsd: r.previousUsd,
              newUsd: r.newUsd,
              reasonHe: r.reasonHe,
              changedAt: r.changedAt,
            }))}
          />
        </details>

        {/*
          Sits with the target it questions. Everything else in the project
          measures quotes against the target; this is the one place that
          measures the target against the quotes.
        */}
        <details>
          <summary>
            <h2 style={{ display: "inline", fontSize: 16 }}>
              בדיקת היתכנות{" "}
              <span className="muted" style={{ fontSize: 13 }}>
                למה אנחנו לא קרובים?
              </span>
            </h2>
          </summary>
          <Guide k="priceAudit" />
          <PriceAudit
            projectId={project.id}
            defaults={{
              retailUsd: projectItems[0]?.targetRetailUsd
                ? Number(projectItems[0].targetRetailUsd)
                : null,
              fbaFeeUsd: projectItems[0]?.fbaFeeUsd ? Number(projectItems[0].fbaFeeUsd) : null,
            }}
          />
        </details>
      </section>

      <section id="step-inbox" className="card stack">
        <h2>
          2 · מה מחכה לך{" "}
          {open.length > 0 && <span className="bad" style={{ fontSize: 14 }}>({open.length})</span>}
        </h2>
        <Guide k="openQuestions" />
        <OpenQuestions
          projectId={project.id}
          questions={open}
          answered={answered}
          awaitingReply={awaitingReply}
          autonomous={mandate.mayNegotiatePrice}
          heldForHuman={heldForHuman.map((t) => ({
            company: t.company,
            reason:
              t.messages[t.messages.length - 1]?.analysis?.needs_human_reason ?? "דורש החלטה שלך",
          }))}
        />
      </section>

      <section id="step-talks" className="card stack">
        <h2>
          3 · שיחות עם ספקים{" "}
          <span className="muted" style={{ fontSize: 14 }}>({repliedCount} ענו)</span>
        </h2>
        <Guide k="replies" />
        <Guide k="priceAsk" />
        <Conversations
          projectId={project.id}
          threads={threads}
          autonomous={mandate.mayNegotiatePrice}
        />
      </section>

      <section id="step-suppliers" className="card stack">
        <h2>
          4 · ספקים <span className="muted" style={{ fontSize: 14 }}>({leads.length})</span>
        </h2>
        <Guide k="suppliers" />

        <details>
          <summary>
            <h2 style={{ display: "inline", fontSize: 16 }}>הוסף ספקים לפי כתובת אתר</h2>
          </summary>
          <Guide k="manualSuppliers" />
          <AddSuppliers projectId={project.id} />
        </details>

        <Suppliers projectId={project.id} leads={leads} />
        <details open={campaign.pending.length > 0}>
          <summary>
            <h2 style={{ display: "inline", fontSize: 16 }}>
              שליחה <span className="muted">({campaign.pending.length})</span>
            </h2>
          </summary>
        <Guide k="campaign" />
        <Guide k="outreachSlot" />
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
          autonomous={project.autonomyTier >= 3}
        />
        </details>
      </section>

      <section id="step-product" className="card stack">
        <h2>5 · המוצר</h2>
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
{issues.length > 0 && (
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
        )}
{parsed && (
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
                        .map((p) => `${p.qty ?? "—"}: ${p.unit_price ?? "?"}`)
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
        )}
<details open={pricing.ready}>
          <summary>
            <h2 style={{ display: "inline", fontSize: 16 }}>
              מודל כלכלי{" "}
              {pricing.ready ? (
                <span className="muted">
                  walk-away{" "}
                  {pricing.products
                    .filter((p) => p.tiers.length > 0)
                    .map((p) => `${p.tiers[p.tiers.length - 1]!.walkAwayFob.toFixed(2)}`)
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

      <section id="step-settings" className="card stack">
        <h2>6 · הגדרות</h2>
<details open>
          <summary>
            <h2 style={{ display: "inline", fontSize: 16 }}>
              רמת אוטונומיה{" "}
              <span className={project.autonomyTier >= 3 ? "good" : "muted"}>
                {project.autonomyTier >= 3 ? "אוטונומי" : "מלווה"}
              </span>
            </h2>
          </summary>
          <Guide k="autonomy" />
          <Autonomy
            projectId={project.id}
            tier={project.autonomyTier}
            sampleBudgetUsd={mandate.sampleBudgetUsd}
            maxToolingUsd={mandate.maxToolingUsd}
            allowSpecSubstitution={project.allowSpecSubstitution}
            maxRounds={mandate.maxRounds}
            ceilings={mandate.ceilings.flatMap((c) =>
              c.tiers.map((t) => ({
                itemName: c.itemName,
                qty: t.qty,
                walkAwayFob: t.ceiling,
              })),
            )}
            blockedReason={mandate.blockedReason}
            absoluteLimits={ABSOLUTE_LIMITS}
          />
        </details>
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
<div className="spread">
          <h2 style={{ margin: 0 }}>Details</h2>
        </div>
        <EditDetails
          projectId={project.id}
          name={project.name}
          keywords={project.keywords}
        />
      </section>
      <Link href="/" className="muted">
        ← All projects
      </Link>
      </main>
    </div>
  );
}
