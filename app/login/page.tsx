"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { login, type LoginState } from "@/lib/actions/auth";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}>
      {pending ? "מתחבר…" : "כניסה"}
    </button>
  );
}

export default function LoginPage() {
  const [state, action] = useActionState<LoginState, FormData>(login, {});

  return (
    <main className="stack" style={{ maxWidth: 380, margin: "8vh auto 0" }}>
      <form action={action} className="card stack" dir="rtl">
        <h2 style={{ margin: 0 }}>כניסה למערכת</h2>
        <div>
          <label htmlFor="email">כתובת מייל</label>
          <input id="email" name="email" type="email" dir="ltr" autoComplete="username" required />
        </div>
        <div>
          <label htmlFor="password">סיסמה</label>
          <input
            id="password"
            name="password"
            type="password"
            dir="ltr"
            autoComplete="current-password"
            required
          />
        </div>
        {state.error && <p className="error">{state.error}</p>}
        <div className="row">
          <Submit />
        </div>
      </form>
    </main>
  );
}
