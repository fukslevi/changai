"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { runAudit, type AuditState } from "@/lib/actions/audit";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}>
      {pending ? "בודק…" : "בדוק את מחיר המטרה"}
    </button>
  );
}

function money(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  return `$${value.toFixed(2)}`;
}

function pct(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "-";
  return `${(value * 100).toFixed(0)}%`;
}

function Row({
  label,
  value,
  strong,
  colour,
}: {
  label: string;
  value: string;
  strong?: boolean;
  colour?: string;
}) {
  return (
    <div className="spread" style={{ fontSize: 13 }}>
      <span className="muted">{label}</span>
      <span style={{ fontWeight: strong ? 600 : 400, color: colour }} dir="ltr">
        {value}
      </span>
    </div>
  );
}

/**
 * Is the target wrong, or is the margin expectation?
 *
 * Everything else in the system runs forwards: the RFQ states a target, quotes
 * are measured against it, and a factory that cannot meet it has failed. That
 * framing can never produce the finding that the target is the problem - and
 * when several independent factories call a number impossible, that is the
 * likeliest finding there is.
 *
 * This runs the same arithmetic backwards from the prices factories actually
 * charge, and says which assumption has to give: the retail price, the return
 * we are demanding, or the belief that a cheaper factory exists.
 */
export function PriceAudit({
  projectId,
  defaults,
}: {
  projectId: string;
  defaults: { retailUsd: number | null; fbaFeeUsd: number | null };
}) {
  const [state, action] = useActionState<AuditState, FormData>(runAudit, {});
  const result = state.result;

  return (
    <div className="stack" dir="rtl">
      <form action={action} className="stack" style={{ gap: 8 }}>
        <input type="hidden" name="projectId" value={projectId} />

        <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ minWidth: 130 }}>
            <label htmlFor="retailUsd">מחיר מכירה</label>
            <input
              id="retailUsd"
              name="retailUsd"
              type="text"
              dir="ltr"
              defaultValue={defaults.retailUsd ?? ""}
              placeholder="129.99"
              required
            />
          </div>
          <div style={{ minWidth: 110 }}>
            <label htmlFor="fbaFeeUsd">עמלת FBA</label>
            <input
              id="fbaFeeUsd"
              name="fbaFeeUsd"
              type="text"
              dir="ltr"
              defaultValue={defaults.fbaFeeUsd ?? ""}
              placeholder="12.00"
            />
          </div>
          <div style={{ minWidth: 110 }}>
            <label htmlFor="freightUsdPerUnit">שילוח ליחידה</label>
            <input
              id="freightUsdPerUnit"
              name="freightUsdPerUnit"
              type="text"
              dir="ltr"
              placeholder="8.00"
            />
          </div>
          <div style={{ minWidth: 90 }}>
            <label htmlFor="referralPct">עמלת פלטפורמה %</label>
            <input id="referralPct" name="referralPct" type="text" dir="ltr" defaultValue="15" />
          </div>
          <div style={{ minWidth: 90 }}>
            <label htmlFor="ppcPct">פרסום %</label>
            <input id="ppcPct" name="ppcPct" type="text" dir="ltr" defaultValue="10" />
          </div>
          <div style={{ minWidth: 90 }}>
            <label htmlFor="dutyRatePct">מכס %</label>
            <input id="dutyRatePct" name="dutyRatePct" type="text" dir="ltr" defaultValue="0" />
          </div>
          <div style={{ minWidth: 90 }}>
            <label htmlFor="targetRoiPct">ROI נדרש %</label>
            <input id="targetRoiPct" name="targetRoiPct" type="text" dir="ltr" defaultValue="100" />
          </div>
        </div>

        {state.error && <p className="error">{state.error}</p>}

        <div className="row">
          <Submit />
        </div>
      </form>

      {result && (
        <div className="stack" style={{ gap: 10 }}>
          {result.verdictHe && (
            <p
              style={{
                margin: 0,
                fontSize: 14,
                lineHeight: 1.6,
                borderRight: "3px solid var(--accent)",
                paddingRight: 10,
              }}
            >
              {result.verdictHe}
            </p>
          )}

          <div className="row" style={{ gap: 24, flexWrap: "wrap", alignItems: "flex-start" }}>
            <div className="stack" style={{ gap: 3, minWidth: 260, flex: 1 }}>
              <strong style={{ fontSize: 13 }}>מה שהמודל שלכם מרשה</strong>
              <Row label="הכנסה נטו אחרי עמלות" value={money(result.netRevenue)} />
              <Row label="עלות נחיתה מקסימלית" value={money(result.maxLanded)} />
              <Row
                label={`מחיר מפעל מקסימלי ב-${pct(result.input.targetRoi)} ROI`}
                value={money(result.walkAwayFob)}
                strong
              />
              <Row label="מחיר המטרה ב-RFQ" value={money(result.rfqTarget)} />
            </div>

            <div className="stack" style={{ gap: 3, minWidth: 260, flex: 1 }}>
              <strong style={{ fontSize: 13 }}>מה שהמפעלים באמת גובים</strong>
              {result.best ? (
                <>
                  <Row label={`ההצעה הזולה (${result.best.company})`} value={money(result.best.fob)} strong />
                  <Row label="עלות נחיתה בפועל" value={money(result.landedAtBest)} />
                  <Row
                    label="ROI במחיר הזה"
                    value={pct(result.roiAtBest)}
                    strong
                    colour={
                      result.roiAtBest !== null && result.roiAtBest >= result.input.targetRoi
                        ? "var(--ok)"
                        : "var(--warn)"
                    }
                  />
                  <Row
                    label={`מחיר מדף שיביא ל-${pct(result.input.targetRoi)}`}
                    value={money(result.retailForTargetRoi)}
                  />
                </>
              ) : (
                <span className="muted" style={{ fontSize: 13 }}>
                  אף ספק עוד לא מסר מחיר למוצר הזה
                </span>
              )}
              {result.refusals > 0 && (
                <Row
                  label="מפעלים שאמרו שהמטרה בלתי אפשרית"
                  value={String(result.refusals)}
                  colour="var(--warn)"
                />
              )}
            </div>
          </div>

          {result.quotes.length > 0 && (
            <details>
              <summary className="muted" style={{ cursor: "pointer", fontSize: 12.5 }}>
                כל ההצעות שנכנסו לחישוב ({result.quotes.length})
              </summary>
              <ul className="list" style={{ marginTop: 6 }}>
                {result.quotes.map((quote) => (
                  <li key={`${quote.company}-${quote.fob}`} style={{ fontSize: 12.5 }}>
                    <div className="spread">
                      <span>{quote.company}</span>
                      <span dir="ltr">
                        {money(quote.fob)}
                        {quote.qty ? ` · ${quote.qty.toLocaleString()} יח'` : ""}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                נספרות רק שורות שתומחרו עבור אחד המוצרים ב-RFQ. אביזרים נלווים, חלקי חילוף ותיקי
                נשיאה לא נכנסים לחישוב מרווח.
              </p>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
