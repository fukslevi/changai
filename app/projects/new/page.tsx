"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Guide } from "@/app/Guide";
import { createProject, type CreateProjectState } from "@/lib/actions/projects";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}>
      {pending ? "יוצר…" : "צור והמשך"}
    </button>
  );
}

/**
 * Two fields and a file.
 *
 * Everything else this project needs either comes out of the RFQ - quantities,
 * specification, target prices - or is a company standing rule. Asking for it
 * here would mean asking the operator to type things the document already says,
 * before they have any reason to care. What genuinely cannot be derived is
 * asked for later, in the queue, next to the work it unblocks.
 */
export default function NewProjectPage() {
  const [state, action] = useActionState<CreateProjectState, FormData>(createProject, {});
  const [showKeywords, setShowKeywords] = useState(false);
  const [mode, setMode] = useState<"production" | "screening">("production");

  return (
    <main className="stack">
      <div className="spread">
        <h2 style={{ margin: 0 }} dir="rtl">
          פרויקט חדש
        </h2>
        <Link href="/" className="muted">
          ביטול
        </Link>
      </div>

      <form action={action} className="card stack">
        <div dir="rtl" className="stack" style={{ gap: 6 }}>
          <label>סוג הפרויקט</label>
          <label className="row" style={{ gap: 8, alignItems: "flex-start" }}>
            <input
              type="radio"
              name="projectMode"
              value="production"
              checked={mode === "production"}
              onChange={() => setMode("production")}
              style={{ marginTop: 3 }}
            />
            <span>
              <strong>תהליך מלא לקראת ייצור</strong>
              <div className="muted" style={{ fontSize: 12.5 }}>
                RFQ מלא, ספציפיקציה, תעודות ואריזה, ומיקוח עד המחיר הסופי.
              </div>
            </span>
          </label>
          <label className="row" style={{ gap: 8, alignItems: "flex-start" }}>
            <input
              type="radio"
              name="projectMode"
              value="screening"
              checked={mode === "screening"}
              onChange={() => setMode("screening")}
              style={{ marginTop: 3 }}
            />
            <span>
              <strong>בדיקת מחיר מטרה מהירה</strong>
              <div className="muted" style={{ fontSize: 12.5 }}>
                בלי RFQ, בלי ספציפיקציה, בלי בידול - רק בדיקה מהירה מול הרבה ספקים האם אפשר
                להגיע למחיר מטרה כולל משלוח.
              </div>
            </span>
          </label>
        </div>

        <div>
          <label htmlFor="name">שם המוצר</label>
          <input id="name" name="name" type="text" placeholder="Rear Bike Basket" required />
          <Guide k="productName" />
        </div>

        {mode === "screening" ? (
          <>
            <div>
              <label htmlFor="screeningTarget">מחיר מטרה ($, כולל משלוח)</label>
              <input
                id="screeningTarget"
                name="screeningTarget"
                type="number"
                step="0.01"
                min="0"
                placeholder="32.50"
                required
              />
              <p className="muted" style={{ fontSize: 12.5, margin: "4px 0 0" }} dir="rtl">
                המחיר שאתה צריך לקבל מהספק כדי לעמוד ב-ROI היעד - כולל שילוח.
              </p>
            </div>
            <div>
              <label htmlFor="screeningTiers">כמויות (מופרדות בפסיק)</label>
              <input id="screeningTiers" name="screeningTiers" type="text" placeholder="500, 1000, 3000" />
            </div>
          </>
        ) : (
          <div>
            <label htmlFor="rfq">מסמך ה-RFQ</label>
            <input id="rfq" name="rfq" type="file" accept=".pdf,.docx" />
            <Guide k="rfqFile" />
          </div>
        )}

        <label className="row" style={{ gap: 8, alignItems: "flex-start" }} dir="rtl">
          <input
            type="checkbox"
            name="autonomous"
            defaultChecked={mode === "screening"}
            style={{ marginTop: 3 }}
          />
          <span>
            <strong>מצב אוטונומי</strong>
            <div className="muted" style={{ fontSize: 12.5 }}>
              {mode === "screening"
                ? "שולח וממשיך מול כל הספקים לבד כדי לקבל הצעות מחיר מהר - עדיין לעולם לא יזמין, ישלם או יתחייב."
                : "מנהל את ההתכתבות עד הסוף, כולל מיקוח - עד התקרה שנגזרת ממחיר המדף. לא יתמקח לפני שתזין את מחיר המדף, ולעולם לא יזמין, ישלם או יתחייב."}
            </div>
          </span>
        </label>

        <div dir="rtl">
          <button
            type="button"
            className="ghost"
            onClick={() => setShowKeywords((v) => !v)}
            style={{ padding: "4px 8px", fontSize: 12.5 }}
          >
            {showKeywords ? "הסתר מילות מפתח" : "מילות מפתח לחיפוש (לא חובה)"}
          </button>
          {showKeywords ? (
            <div style={{ marginTop: 8 }}>
              <textarea
                id="keywords"
                name="keywords"
                rows={6}
                placeholder={
                  "rear bike basket\nsteel wire bike basket\nmetal bicycle basket manufacturer\nbike basket factory china"
                }
              />
              <Guide k="keywords" />
            </div>
          ) : (
            <p className="muted" style={{ margin: "6px 0 0", fontSize: 12.5 }}>
              ייגזרו משם המוצר. אפשר לחדד אחרי שה-RFQ ייקרא ותדעו איך המוצר באמת מתואר.
            </p>
          )}
        </div>

        {state.error && <p className="error">{state.error}</p>}

        <div className="row">
          <Submit />
          <span className="muted" style={{ fontSize: 12.5 }} dir="rtl">
            הצעד הבא: קריאת ה-RFQ, ואז שלוש שאלות
          </span>
        </div>
      </form>
    </main>
  );
}
