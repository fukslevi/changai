import type { Comparison } from "@/lib/quotes/compare";

/**
 * The shortlist as a table.
 *
 * Ordered by headroom, so the supplier you can most afford is first. Refusals
 * sit at the bottom rather than off the page: three factories independently
 * saying a target is unreachable is a finding about the target, and it only
 * exists if the ones who said no are still shown.
 */
function money(value: number | null): string {
  return value === null ? "-" : `$${value.toFixed(2)}`;
}

export interface TargetNote {
  itemName: string | null;
  qty: number | null;
  previousUsd: string | null;
  newUsd: string;
  reasonHe: string | null;
  changedAt: Date;
}

export function Comparison({
  data,
  latestRevision,
}: {
  data: Comparison;
  /**
   * Shown next to the target, because the gap is measured against it.
   *
   * A reader who sees +6% and does not know the target moved last week is
   * reading a different number than the one that was negotiated.
   */
  latestRevision?: TargetNote | null;
}) {
  if (data.suppliers.length === 0) {
    return (
      <p className="muted" dir="rtl" style={{ margin: 0 }}>
        עדיין אין הצעות. הן נקראות אוטומטית מכל תשובה שמכילה מחירים.
      </p>
    );
  }

  const priced = data.suppliers.filter((s) => s.lines.length > 0);
  const refused = data.suppliers.filter((s) => s.lines.length === 0);

  return (
    <div className="stack" dir="rtl">
      <p className="muted" style={{ margin: 0 }}>
        {priced.length} עם מחירים · {data.refusals} דחו את מחיר המטרה
        {data.targetByQty && (
          <>
            {" · מחיר מטרה: "}
            {[...data.targetByQty]
              .sort((a, b) => a[0] - b[0])
              .map(([qty, value]) => `${qty.toLocaleString()}=${money(value)}`)
              .join("  ")}
            {` · יעד: עד ${data.acceptableGapPct}% מעל`}
          </>
        )}
      </p>

      {latestRevision && (
        <p
          className="muted"
          style={{ margin: 0, fontSize: 12.5, color: "var(--warn)" }}
        >
          מחיר המטרה עודכן{" "}
          {new Date(latestRevision.changedAt).toLocaleDateString("he-IL", {
            day: "2-digit",
            month: "2-digit",
          })}
          {": "}
          <span dir="ltr">
            {latestRevision.previousUsd ? `$${Number(latestRevision.previousUsd).toFixed(2)}` : "-"}
            {" ← "}
            ${Number(latestRevision.newUsd).toFixed(2)}
          </span>
          {latestRevision.reasonHe ? ` · ${latestRevision.reasonHe}` : ""}
          {" · הפערים למטה נמדדים מול המחיר החדש"}
        </p>
      )}

      {priced.map((supplier) => (
        <div key={supplier.supplierId} className="stack" style={{ gap: 6 }}>
          <div className="spread">
            <strong>{supplier.company}</strong>
            <span className="muted" style={{ fontSize: 12.5 }}>
              {[
                supplier.incoterm,
                supplier.moq ? `MOQ ${supplier.moq}` : null,
                supplier.leadTimeDays ? `${supplier.leadTimeDays} ימים` : null,
                supplier.cartonDimensionsCm
                  ? `קרטון ${supplier.cartonDimensionsCm}${supplier.unitsPerCarton ? ` · ${supplier.unitsPerCarton} יח'` : ""}`
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr className="muted" style={{ textAlign: "right", fontSize: 12 }}>
                  <th style={{ padding: "4px 6px" }}>פריט</th>
                  <th style={{ padding: "4px 6px" }}>כמות</th>
                  <th style={{ padding: "4px 6px" }}>מחיר הספק</th>
                  <th style={{ padding: "4px 6px" }}>מחיר מטרה</th>
                  <th style={{ padding: "4px 6px" }}>פער</th>
                </tr>
              </thead>
              <tbody>
                {supplier.lines.map((line, i) => (
                  <tr key={`${line.itemName}-${line.qty}-${i}`} style={{ borderTop: "1px solid var(--line)" }}>
                    <td style={{ padding: "4px 6px" }} title={line.specNote ?? undefined}>
                      {line.itemName.slice(0, 44)}
                      {line.specNote && <span className="muted"> ⓘ</span>}
                    </td>
                    <td style={{ padding: "4px 6px" }} dir="ltr">
                      {line.qty?.toLocaleString() ?? "-"}
                    </td>
                    <td style={{ padding: "4px 6px" }} dir="ltr">
                      {money(line.quotedFob)}
                    </td>
                    <td className="muted" style={{ padding: "4px 6px" }} dir="ltr">
                      {money(line.target)}
                    </td>
                    <td
                      style={{
                        padding: "4px 6px",
                        fontWeight: 600,
                        color:
                          line.acceptable === null
                            ? "var(--muted)"
                            : line.acceptable
                              ? "var(--ok)"
                              : "var(--bad)",
                      }}
                      dir="ltr"
                    >
                      {line.gapPct === null
                        ? "-"
                        : `${line.gapPct >= 0 ? "+" : ""}${line.gapPct.toFixed(0)}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {supplier.deviations.length > 0 && (
            <details>
              <summary className="bad" style={{ cursor: "pointer", fontSize: 12.5 }}>
                {supplier.deviations.length} סטיות מהמפרט - מחיר זול יותר למוצר אחר הוא לא מחיר
                זול יותר
              </summary>
              <ul className="list" style={{ marginTop: 6, fontSize: 12.5 }}>
                {supplier.deviations.map((d) => (
                  <li key={d.our_requirement}>
                    <span className="muted">{d.our_requirement}</span>
                    <div>← {d.what_they_offer}</div>
                    {d.their_reason && (
                      <div className="muted" style={{ fontSize: 12 }}>
                        {d.their_reason}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      ))}

      {refused.length > 0 && (
        <details>
          <summary className="muted" style={{ cursor: "pointer", fontSize: 13 }}>
            {refused.length} ספקים ללא תמחור - מה שהם אמרו על המחיר
          </summary>
          <ul className="list" style={{ marginTop: 8 }}>
            {refused.map((supplier) => (
              <li key={supplier.supplierId}>
                <div className="spread">
                  <strong>{supplier.company}</strong>
                  {supplier.rejectsTargetPrice && (
                    <span className="tag" style={{ color: "var(--bad)" }}>
                      דוחה את המטרה
                    </span>
                  )}
                </div>
                {supplier.priceObjection && (
                  <p dir="ltr" style={{ margin: "4px 0 0", fontSize: 12.5 }}>
                    &ldquo;{supplier.priceObjection}&rdquo;
                  </p>
                )}
                {supplier.summaryHe && (
                  <p className="muted" style={{ margin: "4px 0 0", fontSize: 12.5 }}>
                    {supplier.summaryHe}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
