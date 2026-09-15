"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { runIntakeNow, updateIntakeSheetUrl, type IntakeState } from "@/lib/actions/intake";

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}>
      {pending ? "שומר…" : "שמור"}
    </button>
  );
}

function CheckButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="ghost" disabled={pending}>
      {pending ? "בודק…" : "בדוק עכשיו"}
    </button>
  );
}

function Feedback({ state }: { state: IntakeState }) {
  if (state.error) return <p className="error">{state.error}</p>;
  if (state.ok) return <p style={{ color: "var(--ok)", fontSize: 13 }}>{state.ok}</p>;
  return null;
}

/**
 * The product intake sheet - a screening project per new row, checked every
 * 24 hours by the scheduled cycle. "בדוק עכשיו" runs the same check on
 * demand, so a new row does not have to wait for the next scheduled pass to
 * be seen.
 */
export function ProductIntake({
  sheetUrl,
  lastRow,
}: {
  sheetUrl: string | null;
  lastRow: number;
}) {
  const [saveState, saveAction] = useActionState<IntakeState, FormData>(updateIntakeSheetUrl, {});
  const [checkState, checkAction] = useActionState<IntakeState, FormData>(runIntakeNow, {});

  return (
    <div className="stack" dir="rtl">
      <form action={saveAction} className="stack">
        <div>
          <label htmlFor="sheetUrl">כתובת הגיליון</label>
          <input
            id="sheetUrl"
            name="sheetUrl"
            type="text"
            dir="ltr"
            defaultValue={sheetUrl ?? ""}
            placeholder="https://docs.google.com/spreadsheets/d/…/edit#gid=0"
            required
          />
          <p className="hint">
            הגיליון חייב להיות משותף כ&quot;כל מי שיש לו קישור - צופה&quot;, כי השרת קורא אותו בלי
            להתחבר לחשבון Google. עמודות נדרשות: <code dir="ltr">product name</code>,{" "}
            <code dir="ltr">MOQ</code>, <code dir="ltr">Target EXW price</code>. עמודות{" "}
            <code dir="ltr">Product variation A/B/C</code> - כל אחת הופכת לפריט נפרד באותו פרויקט.
          </p>
        </div>
        <Feedback state={saveState} />
        <div className="row">
          <SaveButton />
        </div>
      </form>

      {sheetUrl && (
        <form action={checkAction} className="stack" style={{ gap: 6 }}>
          <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
            {lastRow} שורות יובאו עד כה
          </p>
          <div className="row">
            <CheckButton />
          </div>
          <Feedback state={checkState} />
        </form>
      )}
    </div>
  );
}
