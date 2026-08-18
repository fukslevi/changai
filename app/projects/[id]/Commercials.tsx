"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  saveCommercials,
  saveProductCommercials,
  type CommercialsState,
} from "@/lib/actions/commercials";

export interface ProductRow {
  itemId: string;
  name: string;
  rfqTargetFob: number | null;
  targetRetailUsd: number | null;
  fbaFeeUsd: number | null;
  cbmPerUnit: number | null;
  missing: string[];
  verdict: {
    netRevenue: number;
    maxLanded: number;
    walkAwayFob: number;
  } | null;
}

export interface CommercialsProps {
  projectId: string;
  targetRoi: number | null;
  ppcPct: number | null;
  roiAfterPpc: boolean;
  referralPct: number | null;
  hsCode: string | null;
  dutyRatePct: number | null;
  freightUsdPerCbm: number | null;
  inboundUsdPerUnit: number | null;
  products: ProductRow[];
}

function Save() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="ghost" disabled={pending}>
      {pending ? "שומר…" : "שמור"}
    </button>
  );
}

function Feedback({ state }: { state: CommercialsState }) {
  if (state.error) return <p className="error">{state.error}</p>;
  if (state.ok) return <p style={{ color: "var(--ok)", fontSize: 13 }}>{state.ok}</p>;
  return null;
}

function Field({
  name,
  label,
  hint,
  value,
  step,
  suffix,
}: {
  name: string;
  label: string;
  hint?: string;
  value: number | string | null;
  step?: string;
  suffix?: string;
}) {
  return (
    <label className="stack" style={{ gap: 2, minWidth: 150 }}>
      <span style={{ fontSize: 13 }}>
        {label} {suffix && <span className="muted">{suffix}</span>}
      </span>
      <input
        name={name}
        type={step ? "number" : "text"}
        step={step}
        min={step ? "0" : undefined}
        defaultValue={value ?? ""}
        dir="ltr"
        style={{ width: 130 }}
      />
      {hint && (
        <span className="muted" style={{ fontSize: 11.5 }}>
          {hint}
        </span>
      )}
    </label>
  );
}

function money(value: number): string {
  return `$${value.toFixed(2)}`;
}

function Product({ projectId, row }: { projectId: string; row: ProductRow }) {
  const [state, save] = useActionState<CommercialsState, FormData>(saveProductCommercials, {});

  const gap =
    row.verdict && row.rfqTargetFob !== null ? row.verdict.walkAwayFob - row.rfqTargetFob : null;

  return (
    <li>
      <form action={save} className="stack" style={{ gap: 8 }}>
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="itemId" value={row.itemId} />

        <div className="spread">
          <strong>{row.name}</strong>
          <span className="muted">
            {row.rfqTargetFob !== null ? `מחיר מטרה ב-RFQ: ${money(row.rfqTargetFob)}` : "אין מחיר מטרה"}
          </span>
        </div>

        <div className="row" style={{ flexWrap: "wrap", gap: 12 }}>
          <Field
            name="targetRetailUsd"
            label="מחיר מדף"
            suffix="$"
            step="0.01"
            value={row.targetRetailUsd}
            hint="המחיר שתמכרו בו באמזון"
          />
          <Field
            name="fbaFeeUsd"
            label="עמלת FBA"
            suffix="$"
            step="0.01"
            value={row.fbaFeeUsd}
            hint="לפי גודל ומשקל"
          />
          <Field
            name="assumedCbmPerUnit"
            label="נפח ליחידה"
            suffix="CBM"
            step="0.00001"
            value={row.cbmPerUnit}
            hint="עד שיגיעו מידות קרטון אמיתיות"
          />
          <div style={{ alignSelf: "flex-end", paddingBottom: 18 }}>
            <Save />
          </div>
        </div>

        {row.verdict ? (
          <div
            className="stack"
            style={{
              gap: 2,
              borderTop: "1px solid var(--line)",
              paddingTop: 8,
              fontSize: 13,
            }}
          >
            <div className="spread">
              <span className="muted">נשאר אחרי עמלות ופרסום</span>
              <span dir="ltr">{money(row.verdict.netRevenue)}</span>
            </div>
            <div className="spread">
              <span className="muted">עלות נחיתה מקסימלית</span>
              <span dir="ltr">{money(row.verdict.maxLanded)}</span>
            </div>
            <div className="spread">
              <strong>מחיר FOB מקסימלי - walk-away</strong>
              <strong dir="ltr" style={{ color: "var(--accent)" }}>
                {money(row.verdict.walkAwayFob)}
              </strong>
            </div>
            {gap !== null && (
              <div
                className="spread"
                style={{ color: gap >= 0 ? "var(--ok)" : "var(--bad)" }}
              >
                <span>
                  {gap >= 0
                    ? "מחיר המטרה ב-RFQ עומד בכלל"
                    : "מחיר המטרה ב-RFQ כבר חורג מהכלל"}
                </span>
                <span dir="ltr">
                  {gap >= 0 ? "+" : ""}
                  {money(gap)}
                </span>
              </div>
            )}
          </div>
        ) : (
          <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>
            חסר: {row.missing.join(" · ")}
          </p>
        )}

        <Feedback state={state} />
      </form>
    </li>
  );
}

export function Commercials(props: CommercialsProps) {
  const [state, save] = useActionState<CommercialsState, FormData>(saveCommercials, {});

  return (
    <div className="stack" dir="rtl">
      <form action={save} className="stack" style={{ gap: 8 }}>
        <input type="hidden" name="projectId" value={props.projectId} />

        <div className="row" style={{ flexWrap: "wrap", gap: 12 }}>
          <Field
            name="targetRoi"
            label="יעד ROI"
            step="0.05"
            value={props.targetRoi}
            hint="1 = החזר מלא על ההשקעה"
          />
          <Field
            name="dutyRatePct"
            label="מכס"
            suffix="%"
            step="0.1"
            value={props.dutyRatePct}
            hint="כולל סעיף 301 אם חל"
          />
          <Field
            name="hsCode"
            label="סיווג HS"
            value={props.hsCode}
            hint="לתיעוד ולבדיקה חוזרת"
          />
          <Field
            name="freightUsdPerCbm"
            label="שילוח לקוב"
            suffix="$"
            step="1"
            value={props.freightUsdPerCbm}
            hint="ימי, עד המחסן"
          />
          <Field
            name="inboundUsdPerUnit"
            label="כניסה למחסן"
            suffix="$"
            step="0.01"
            value={props.inboundUsdPerUnit}
            hint="ליחידה"
          />
          <Field
            name="referralPct"
            label="עמלת אמזון"
            suffix="%"
            step="0.5"
            value={props.referralPct}
          />
          <Field
            name="ppcPct"
            label="פרסום"
            suffix="%"
            step="0.5"
            value={props.ppcPct}
            hint="מתוך המחזור"
          />
        </div>

        <label className="row" style={{ gap: 6, fontSize: 13 }}>
          <input type="checkbox" name="roiAfterPpc" defaultChecked={props.roiAfterPpc} />
          <span>ה-ROI נמדד אחרי פרסום</span>
        </label>

        <div className="row">
          <Save />
          <span className="muted" style={{ fontSize: 12.5 }}>
            ההנחות האלה חלות על כל המוצרים בפרויקט
          </span>
        </div>
        <Feedback state={state} />
      </form>

      {props.products.length > 0 && (
        <ul className="list">
          {props.products.map((row) => (
            <Product key={row.itemId} projectId={props.projectId} row={row} />
          ))}
        </ul>
      )}
    </div>
  );
}
