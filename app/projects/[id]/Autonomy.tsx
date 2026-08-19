"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { saveAutonomy, type AutonomyState } from "@/lib/actions/autonomy";

export interface AutonomyProps {
  projectId: string;
  tier: number;
  sampleBudgetUsd: number | null;
  maxToolingUsd: number | null;
  allowSpecSubstitution: boolean;
  maxRounds: number;
  /** Ceilings the mandate would negotiate against, for display. */
  ceilings: { itemName: string; qty: number; walkAwayFob: number }[];
  blockedReason: string | null;
  absoluteLimits: string[];
}

function Save() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}>
      {pending ? "שומר…" : "שמור"}
    </button>
  );
}

export function Autonomy(props: AutonomyProps) {
  const [state, save] = useActionState<AutonomyState, FormData>(saveAutonomy, {});
  const [tier, setTier] = useState(props.tier);

  const full = tier >= 3;

  return (
    <form action={save} className="stack" dir="rtl" style={{ gap: 10 }}>
      <input type="hidden" name="projectId" value={props.projectId} />

      <div className="stack" style={{ gap: 6 }}>
        <label className="row" style={{ gap: 8, alignItems: "flex-start" }}>
          <input
            type="radio"
            name="tier"
            value="1"
            checked={tier === 1}
            onChange={() => setTier(1)}
            style={{ marginTop: 3 }}
          />
          <span>
            <strong>מלווה</strong>
            <div className="muted" style={{ fontSize: 12.5 }}>
              עונה על שאלות עובדתיות, רודף אחרי נתונים חסרים, שולח תזכורות. כל מה שנוגע
              למחיר או למפרט עוצר אצלך.
            </div>
          </span>
        </label>

        <label className="row" style={{ gap: 8, alignItems: "flex-start" }}>
          <input
            type="radio"
            name="tier"
            value="3"
            checked={tier === 3}
            onChange={() => setTier(3)}
            style={{ marginTop: 3 }}
          />
          <span>
            <strong>אוטונומי</strong>
            <div className="muted" style={{ fontSize: 12.5 }}>
              מנהל את המשא ומתן עד הסוף - מתמקח על מחיר, עונה לספק שחולק על דרישה, סוגר
              תנאים. פותח במחיר המטרה ולעולם לא חוצה את התקרה.
            </div>
          </span>
        </label>
      </div>

      {full && props.blockedReason && <p className="bad">{props.blockedReason}</p>}

      {full && props.ceilings.length > 0 && (
        <div className="stack" style={{ gap: 2 }}>
          <span className="muted" style={{ fontSize: 12.5 }}>
            התקרות שהמערכת תעבוד מולן. הן לא נחשפות לספק אף פעם:
          </span>
          <ul className="list" style={{ fontSize: 13 }}>
            {props.ceilings.map((c) => (
              <li key={`${c.itemName}-${c.qty}`}>
                <div className="spread">
                  <span>
                    {c.itemName} · {c.qty.toLocaleString()} יח&apos;
                  </span>
                  <strong dir="ltr" style={{ color: "var(--accent)" }}>
                    ${c.walkAwayFob.toFixed(2)}
                  </strong>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {full && (
        <div className="row" style={{ flexWrap: "wrap", gap: 14 }}>
          <label className="stack" style={{ gap: 2 }}>
            <span style={{ fontSize: 13 }}>
              תקציב דגימות <span className="muted">$</span>
            </span>
            <input
              name="sampleBudgetUsd"
              type="number"
              step="1"
              min="0"
              dir="ltr"
              defaultValue={props.sampleBudgetUsd ?? 0}
              style={{ width: 110 }}
            />
            <span className="muted" style={{ fontSize: 11.5 }}>
              0 = לא מאשר דגימות
            </span>
          </label>

          <label className="stack" style={{ gap: 2 }}>
            <span style={{ fontSize: 13 }}>
              תקציב תבניות <span className="muted">$</span>
            </span>
            <input
              name="maxToolingUsd"
              type="number"
              step="1"
              min="0"
              dir="ltr"
              defaultValue={props.maxToolingUsd ?? 0}
              style={{ width: 110 }}
            />
            <span className="muted" style={{ fontSize: 11.5 }}>
              0 = לא מאשר תבניות
            </span>
          </label>

          <label className="stack" style={{ gap: 2 }}>
            <span style={{ fontSize: 13 }}>סבבים מקסימלי</span>
            <input
              name="maxRounds"
              type="number"
              step="1"
              min="1"
              max="12"
              dir="ltr"
              defaultValue={props.maxRounds}
              style={{ width: 110 }}
            />
            <span className="muted" style={{ fontSize: 11.5 }}>
              ואז עובר אליך
            </span>
          </label>
        </div>
      )}

      {full && (
        <label className="row" style={{ gap: 6, fontSize: 13 }}>
          <input
            type="checkbox"
            name="allowSpecSubstitution"
            defaultChecked={props.allowSpecSubstitution}
          />
          <span>
            מותר לקבל חלופה למפרט
            <span className="muted">
              {" "}
              - הספק שמציע אותה הוא גם מי שמרוויח ממנה
            </span>
          </span>
        </label>
      )}

      {full && (
        <details>
          <summary className="muted" style={{ cursor: "pointer", fontSize: 12.5 }}>
            מה נשאר אסור בכל מצב ({props.absoluteLimits.length})
          </summary>
          <ul className="list" style={{ marginTop: 6, fontSize: 12.5 }} dir="ltr">
            {props.absoluteLimits.map((limit) => (
              <li key={limit}>{limit}</li>
            ))}
          </ul>
        </details>
      )}

      <div className="row">
        <Save />
        {state.error && <span className="error">{state.error}</span>}
        {state.ok && <span style={{ color: "var(--ok)", fontSize: 13 }}>{state.ok}</span>}
      </div>
    </form>
  );
}
