"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  approveAllAbove,
  decideLead,
  findSuppliers,
  refreshLeadEmail,
  refreshMissingEmails,
  setLeadEmail,
  type DiscoveryState,
} from "@/lib/actions/discovery";

export interface LeadRow {
  id: string;
  companyName: string;
  website: string | null;
  email: string | null;
  country: string | null;
  matchScore: number | null;
  matchRationale: string | null;
  status: "pending" | "approved" | "rejected" | "contacted";
}

function Submit({
  label,
  pendingLabel,
  ghost,
}: {
  label: string;
  pendingLabel: string;
  ghost?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={ghost ? "ghost" : undefined} disabled={pending}>
      {pending ? pendingLabel : label}
    </button>
  );
}

function Feedback({ state }: { state: DiscoveryState }) {
  if (state.error) return <p className="error">{state.error}</p>;
  if (state.ok) return <p style={{ color: "var(--ok)", fontSize: 13 }}>{state.ok}</p>;
  return null;
}

function scoreColour(score: number | null): string {
  if (score === null) return "var(--muted)";
  if (score >= 60) return "var(--ok)";
  if (score >= 40) return "var(--accent)";
  return "var(--muted)";
}

/**
 * A lead with no address is not a dead lead - the crawler simply missed it.
 * Both ways back in live here: retry the site, or paste what you found yourself.
 */
function MissingEmail({ leadId, projectId }: { leadId: string; projectId: string }) {
  const [retryState, retry] = useActionState<DiscoveryState, FormData>(refreshLeadEmail, {});
  const [saveState, save] = useActionState<DiscoveryState, FormData>(setLeadEmail, {});

  return (
    <div className="stack" style={{ gap: 6, marginTop: 8 }}>
      <div className="row">
        <form action={retry}>
          <input type="hidden" name="leadId" value={leadId} />
          <input type="hidden" name="projectId" value={projectId} />
          <Submit label="חפש מייל שוב" pendingLabel="סורק…" ghost />
        </form>
        <form action={save} className="row" style={{ gap: 6 }}>
          <input type="hidden" name="leadId" value={leadId} />
          <input type="hidden" name="projectId" value={projectId} />
          <input
            type="email"
            name="email"
            placeholder="או הדבק כתובת מהאתר"
            dir="ltr"
            style={{ width: 240 }}
          />
          <Submit label="שמור" pendingLabel="…" ghost />
        </form>
      </div>
      <Feedback state={retryState} />
      <Feedback state={saveState} />
    </div>
  );
}

export function Suppliers({ projectId, leads }: { projectId: string; leads: LeadRow[] }) {
  const [findState, find] = useActionState<DiscoveryState, FormData>(findSuppliers, {});
  const [decideState, decide] = useActionState<DiscoveryState, FormData>(decideLead, {});
  const [bulkState, bulk] = useActionState<DiscoveryState, FormData>(approveAllAbove, {});
  const [sweepState, sweep] = useActionState<DiscoveryState, FormData>(refreshMissingEmails, {});

  const pending = leads.filter((l) => l.status === "pending");
  const approved = leads.filter((l) => l.status === "approved" || l.status === "contacted");
  const rejected = leads.filter((l) => l.status === "rejected");

  return (
    <div className="stack">
      <form action={find}>
        <input type="hidden" name="projectId" value={projectId} />
        <div className="row">
          <Submit label="חפש ספקים" pendingLabel="מחפש…" />
          <span className="muted" dir="rtl">
            כשתי דקות. לא נשלח דבר.
          </span>
        </div>
        <Feedback state={findState} />
      </form>

      {leads.length > 0 && (
        <p className="muted" dir="rtl">
          {pending.length} ממתינים · {approved.length} אושרו · {rejected.length} נדחו
        </p>
      )}

      {pending.length > 0 && (
        <form action={bulk}>
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="threshold" value="50" />
          <div className="row">
            <Submit label="אשר את כל מי שמעל 50" pendingLabel="מאשר…" ghost />
            <span className="muted" dir="rtl">
              רק מי שיש לו כתובת מייל
            </span>
          </div>
          <Feedback state={bulkState} />
        </form>
      )}

      {pending.some((l) => !l.email) && (
        <form action={sweep}>
          <input type="hidden" name="projectId" value={projectId} />
          <div className="row">
            <Submit
              label={`חפש מייל ל-${pending.filter((l) => !l.email).length} ללא כתובת`}
              pendingLabel="סורק אתרים…"
              ghost
            />
          </div>
          <Feedback state={sweepState} />
        </form>
      )}

      <Feedback state={decideState} />

      <ul className="list">
        {[...pending, ...approved, ...rejected].map((lead) => (
          <li
            key={lead.id}
            style={{ opacity: lead.status === "rejected" ? 0.45 : 1 }}
          >
            <div className="spread">
              <div>
                <strong>{lead.companyName}</strong>{" "}
                {lead.status !== "pending" && (
                  <span className="tag">
                    {lead.status === "approved"
                      ? "אושר"
                      : lead.status === "contacted"
                        ? "נשלח"
                        : "נדחה"}
                  </span>
                )}
                <div className="muted" style={{ marginTop: 2 }}>
                  {lead.website && (
                    <a href={lead.website} target="_blank" rel="noreferrer">
                      {lead.website.replace(/^https?:\/\//, "")}
                    </a>
                  )}
                  {lead.email ? (
                    <> · {lead.email}</>
                  ) : (
                    <>
                      {" "}
                      · <span className="bad">אין כתובת מייל</span>
                    </>
                  )}
                </div>
              </div>
              <strong
                style={{ color: scoreColour(lead.matchScore), fontSize: 20, minWidth: 40, textAlign: "right" }}
              >
                {lead.matchScore ?? "?"}
              </strong>
            </div>

            {lead.matchRationale && (
              <p className="muted" style={{ marginTop: 6, fontSize: 12.5 }}>
                {lead.matchRationale}
              </p>
            )}

            {lead.status === "pending" && !lead.email && (
              <MissingEmail leadId={lead.id} projectId={projectId} />
            )}

            {lead.status === "pending" && (
              <div className="row" style={{ marginTop: 10 }}>
                <form action={decide}>
                  <input type="hidden" name="leadId" value={lead.id} />
                  <input type="hidden" name="projectId" value={projectId} />
                  <input type="hidden" name="decision" value="approved" />
                  <Submit label="אשר" pendingLabel="…" />
                </form>
                <form action={decide}>
                  <input type="hidden" name="leadId" value={lead.id} />
                  <input type="hidden" name="projectId" value={projectId} />
                  <input type="hidden" name="decision" value="rejected" />
                  <Submit label="דחה" pendingLabel="…" ghost />
                </form>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
