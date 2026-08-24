"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { updateTargetPrice, type TargetState } from "@/lib/actions/target";

export interface TargetItem {
  id: string;
  name: string;
  targets: { qty: number | null; unitPrice: number | null }[];
}

export interface TargetRevision {
  itemName: string | null;
  qty: number | null;
  previousUsd: string | null;
  newUsd: string;
  reasonHe: string | null;
  changedAt: Date;
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}>
      {pending ? "מעדכן…" : "עדכן מחיר מטרה"}
    </button>
  );
}

function money(value: number | string | null): string {
  if (value === null) return "-";
  const n = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(n) ? `$${n.toFixed(2)}` : "-";
}

function when(date: Date): string {
  return new Date(date).toLocaleDateString("he-IL", { day: "2-digit", month: "2-digit" });
}

/**
 * Editing the number every negotiation is measured against.
 *
 * The RFQ's target is a starting position, not a fact. When three factories
 * independently say it cannot be met, the useful response is to decide what the
 * product is actually worth paying - and that should not require re-parsing a
 * document or editing a spreadsheet.
 *
 * The old value is kept rather than overwritten, because a gap only means
 * something next to the number it was measured against: Peitai at +31% becomes
 * +6% the moment the target moves, and without the history nothing on the page
 * explains why the same offer suddenly looks good.
 */
export function TargetPrice({
  projectId,
  items,
  revisions,
}: {
  projectId: string;
  items: TargetItem[];
  revisions: TargetRevision[];
}) {
  const [state, action] = useActionState<TargetState, FormData>(updateTargetPrice, {});
  const [itemId, setItemId] = useState(items[0]?.id ?? "");

  const selected = items.find((i) => i.id === itemId) ?? items[0];

  if (items.length === 0) {
    return (
      <p className="muted" dir="rtl" style={{ margin: 0 }}>
        אין עדיין פריטים מתומחרים. מחירי המטרה נקראים מה-RFQ - אחרי שהוא נקרא אפשר לעדכן אותם
        כאן.
      </p>
    );
  }

  return (
    <div className="stack" dir="rtl">
      {revisions.length > 0 && (
        <ul className="list" style={{ marginTop: 0 }}>
          {revisions.map((revision, i) => (
            <li key={`${revision.changedAt}-${i}`} style={{ fontSize: 12.5 }}>
              <span className="muted">{when(revision.changedAt)}</span>{" "}
              {revision.itemName}
              {revision.qty !== null && (
                <span className="muted"> · כמות {revision.qty.toLocaleString()}</span>
              )}
              {": "}
              <span className="muted" dir="ltr">
                {money(revision.previousUsd)}
              </span>
              {" ← "}
              <strong dir="ltr">{money(revision.newUsd)}</strong>
              {revision.reasonHe && <div className="muted">{revision.reasonHe}</div>}
            </li>
          ))}
        </ul>
      )}

      <form action={action} className="stack" style={{ gap: 8 }}>
        <input type="hidden" name="projectId" value={projectId} />

        {items.length > 1 && (
          <div>
            <label htmlFor="itemId">פריט</label>
            <select
              id="itemId"
              name="itemId"
              value={itemId}
              onChange={(e) => setItemId(e.target.value)}
            >
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {items.length === 1 && <input type="hidden" name="itemId" value={itemId} />}

        <div>
          <label htmlFor="qty">מדרגת כמות</label>
          <select id="qty" name="qty" defaultValue="all">
            <option value="all">כל המדרגות</option>
            {selected?.targets
              .filter((t) => t.qty !== null)
              .sort((a, b) => (a.qty ?? 0) - (b.qty ?? 0))
              .map((t) => (
                <option key={t.qty} value={String(t.qty)}>
                  {t.qty?.toLocaleString()} יח&apos; · כרגע {money(t.unitPrice)}
                </option>
              ))}
          </select>
          <p className="hint">
            &quot;כל המדרגות&quot; קובע את אותו מחיר לכל הכמויות. אם המחיר שלך שונה בין מדרגות,
            עדכן אותן אחת-אחת.
          </p>
        </div>

        <div>
          <label htmlFor="newUsd">מחיר מטרה חדש ליחידה</label>
          <input id="newUsd" name="newUsd" type="text" dir="ltr" placeholder="9.50" required />
        </div>

        <div>
          <label htmlFor="reason">למה (לא חובה)</label>
          <input
            id="reason"
            name="reason"
            type="text"
            placeholder="שלושה ספקים אמרו שהמחיר הקודם לא אפשרי"
          />
          <p className="hint">
            נשמר לצד המחיר ומוצג בטבלת ההשוואה. בעוד חודש זה מה שיסביר למה פער של 31% הפך ל-6%.
          </p>
        </div>

        {state.error && <p className="error">{state.error}</p>}
        {state.ok && <p style={{ color: "var(--ok)", fontSize: 13 }}>{state.ok}</p>}

        <div className="row">
          <Submit />
        </div>
      </form>

      {state.affected && state.affected.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <strong style={{ fontSize: 14 }}>
            {state.direction === "raised"
              ? "ספקים ששווה לחזור אליהם"
              : "ספקים שהשינוי מוציא אותם מהטווח"}
          </strong>
          <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
            אף אחד מהם לא קיבל הודעה. לחזור לספק ולומר שהמחיר שלנו השתנה זה מהלך מסחרי - זה
            מסמן לו שהיינו גמישים - אז זה נשאר החלטה שלך. אפשר לענות לכל אחד מהם תחת
            &quot;שיחות עם ספקים&quot;.
          </p>
          <ul className="list">
            {state.affected.map((supplier) => (
              <li key={supplier.supplierId}>
                <div className="spread">
                  <strong>{supplier.company}</strong>
                  {supplier.refusedOldTarget && (
                    <span className="tag" style={{ color: "var(--warn)" }}>
                      דחה את המחיר הקודם
                    </span>
                  )}
                </div>
                <div className="muted" style={{ fontSize: 12.5 }}>
                  {supplier.whyHe}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
