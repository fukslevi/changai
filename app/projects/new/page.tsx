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
        <div>
          <label htmlFor="name">שם המוצר</label>
          <input id="name" name="name" type="text" placeholder="Rear Bike Basket" required />
          <Guide k="productName" />
        </div>

        <div>
          <label htmlFor="rfq">מסמך ה-RFQ</label>
          <input id="rfq" name="rfq" type="file" accept=".pdf,.docx,.pptx" />
          <Guide k="rfqFile" />
        </div>

        <label className="row" style={{ gap: 8, alignItems: "flex-start" }} dir="rtl">
          <input type="checkbox" name="autonomous" defaultChecked style={{ marginTop: 3 }} />
          <span>
            <strong>מצב אוטונומי</strong>
            <div className="muted" style={{ fontSize: 12.5 }}>
              מנהל את ההתכתבות עד הסוף, כולל מיקוח - עד התקרה שנגזרת ממחיר המדף. לא יתמקח
              לפני שתזין את מחיר המדף, ולעולם לא יזמין, ישלם או יתחייב.
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
