"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { addSuppliersByUrl, type ManualState } from "@/lib/actions/manual-suppliers";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}>
      {pending ? "קורא את האתרים…" : "הוסף ספקים"}
    </button>
  );
}

/**
 * Adding suppliers by hand, from URLs.
 *
 * Search finds most of them and misses the ones that matter: a factory a
 * colleague met at a fair, a name off a competitor's packaging, a site that
 * ranks nowhere because it was built in 2009 and never touched. Those are often
 * better leads than anything a query returns.
 *
 * Pasting the URL is the approval. Nobody types a supplier's website in order
 * to think about it later, so a lead added here goes straight to the send queue
 * rather than into a pending list to be approved a second time.
 */
export function AddSuppliers({ projectId }: { projectId: string }) {
  const [state, action] = useActionState<ManualState, FormData>(addSuppliersByUrl, {});

  return (
    <div className="stack" dir="rtl">
      <form action={action} className="stack" style={{ gap: 8 }}>
        <input type="hidden" name="projectId" value={projectId} />

        <div>
          <label htmlFor="urls">כתובות אתרים של ספקים</label>
          <textarea
            id="urls"
            name="urls"
            rows={4}
            dir="ltr"
            placeholder={"sureall-light.com\nwww.chinabikerack.com/contact-us.html\nhttps://example-factory.cn"}
            required
          />
          <p className="hint">
            אחד בכל שורה, או מופרדים בפסיקים. אפשר דומיין, כתובת מלאה או דף &quot;צור קשר&quot; -
            המערכת תיכנס לאתר, תחלץ את כתובת המייל ותדרג את הספק מול המפרט, בדיוק כמו ספק
            שנמצא בחיפוש.
          </p>
          <p className="hint">
            ספקים שמתווספים כאן <strong>לא נספרים במכסת 30 הספקים</strong> של החיפוש האוטומטי.
            המכסה הזאת היא כלל עצירה לחיפוש, לא סיבה לסרב לספק שמצאת בעצמך. מגבלת השליחה
            היומית עדיין חלה - היא שומרת על תיבת המייל.
          </p>
        </div>

        {state.error && <p className="error">{state.error}</p>}
        {state.ok && <p style={{ color: "var(--ok)", fontSize: 13 }}>{state.ok}</p>}

        <div className="row">
          <Submit />
        </div>
      </form>

      {state.added && state.added.length > 0 && (
        <ul className="list">
          {state.added.map((supplier) => (
            <li key={supplier.domain}>
              <div className="spread">
                <div>
                  <strong>{supplier.companyName}</strong>
                  <div className="muted" style={{ fontSize: 12.5 }} dir="ltr">
                    {supplier.domain}
                    {supplier.email && ` · ${supplier.email}`}
                  </div>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  {supplier.matchScore !== null && (
                    <span
                      className="tag"
                      style={{
                        color: supplier.matchScore >= 60 ? "var(--ok)" : "var(--muted)",
                      }}
                    >
                      {supplier.matchScore}
                    </span>
                  )}
                  {supplier.email && !supplier.alreadyKnown && (
                    <span className="tag" style={{ color: "var(--ok)" }}>
                      אושר לשליחה
                    </span>
                  )}
                </div>
              </div>
              {supplier.problemHe && (
                <div
                  className="muted"
                  style={{ fontSize: 12.5, color: supplier.alreadyKnown ? undefined : "var(--warn)" }}
                >
                  {supplier.problemHe}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
