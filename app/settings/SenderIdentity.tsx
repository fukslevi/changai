"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { updateSettings, type SettingsState } from "@/lib/actions/settings";
import type { AppSettings } from "@/lib/settings";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}>
      {pending ? "שומר…" : "שמור"}
    </button>
  );
}

export function SenderIdentity({ current }: { current: AppSettings }) {
  const [state, action] = useActionState<SettingsState, FormData>(updateSettings, {});

  return (
    <form action={action} className="stack" dir="rtl">
      <div>
        <label htmlFor="senderName">שם בחתימה</label>
        <input
          id="senderName"
          name="senderName"
          type="text"
          dir="ltr"
          defaultValue={current.senderName}
          required
        />
        <p className="hint">השם שיופיע בסוף כל מייל לספק. אדם אמיתי, לא פרסונה.</p>
      </div>

      <div>
        <label htmlFor="senderTitle">תפקיד</label>
        <input
          id="senderTitle"
          name="senderTitle"
          type="text"
          dir="ltr"
          defaultValue={current.senderTitle}
          required
        />
        <p className="hint">
          מופיע מתחת לשם, לצד שם החברה. לדוגמה <code>Sourcing</code> או{" "}
          <code>Procurement Manager</code>.
        </p>
      </div>

      <div>
        <label htmlFor="companyName">שם החברה</label>
        <input
          id="companyName"
          name="companyName"
          type="text"
          dir="ltr"
          defaultValue={current.companyName}
          required
        />
      </div>

      <div>
        <label htmlFor="sourcingMailbox">תיבת שליחה</label>
        <input
          id="sourcingMailbox"
          name="sourcingMailbox"
          type="email"
          dir="ltr"
          defaultValue={current.sourcingMailbox}
          required
        />
        <p className="hint">
          חייבת להיות אותה תיבה שאישרתם בזרימת ההסכמה של Gmail. אם הן לא זהות, השליחה תיכשל.
        </p>
      </div>

      <div>
        <label htmlFor="notifyEmail">מייל להתראות</label>
        <input
          id="notifyEmail"
          name="notifyEmail"
          type="email"
          dir="ltr"
          defaultValue={current.notifyEmail}
          required
        />
        <p className="hint">
          לכאן נשלחות התראות בעברית: שאלה פתוחה שרק אתה יכול לענות עליה, ופרויקט שהסתיים. כל
          התראה נשלחת פעם אחת בלבד - שאלה שכבר דווחה לא חוזרת בכל מחזור. עדיף שזו לא תהיה תיבת
          השליחה: שם היא נבלעת בין המיילים של הספקים.
        </p>
      </div>

      {state.error && <p className="error">{state.error}</p>}
      {state.ok && <p style={{ color: "var(--ok)", fontSize: 13 }}>{state.ok}</p>}

      <div className="row">
        <Submit />
      </div>
    </form>
  );
}
