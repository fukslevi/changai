import Link from "next/link";
import { Guide } from "@/app/Guide";
import { logout } from "@/lib/actions/auth";
import { currentUser } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { SenderIdentity } from "./SenderIdentity";

export const dynamic = "force-dynamic";

function Status({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={ok ? "good" : "bad"} style={{ fontSize: 13 }}>
      {ok ? "✓ מחובר" : "✗ חסר"} <span className="muted">{label}</span>
    </span>
  );
}

export default async function SettingsPage() {
  const [user, appSettings] = await Promise.all([currentUser(), getSettings()]);

  const env = {
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
    database: Boolean(process.env.DATABASE_URL),
    search: Boolean(process.env.SERPER_API_KEY || process.env.BRAVE_SEARCH_API_KEY),
    verification: Boolean(process.env.HUNTER_API_KEY),
    gmail: Boolean(
      process.env.GOOGLE_CLIENT_ID &&
        process.env.GOOGLE_CLIENT_SECRET &&
        process.env.GOOGLE_REFRESH_TOKEN,
    ),
    mailbox: process.env.SOURCING_MAILBOX ?? "",
    senderName: process.env.SOURCING_SENDER_NAME ?? "",
    senderTitle: process.env.SOURCING_SENDER_TITLE ?? "",
  };

  return (
    <main className="stack">
      <div className="spread">
        <h2 style={{ margin: 0 }}>הגדרות</h2>
        <form action={logout}>
          <button className="ghost">התנתקות</button>
        </form>
      </div>

      {/* ── Account ─────────────────────────────────────────────────────── */}
      <section className="card stack" dir="rtl">
        <h2>חשבון</h2>
        <p className="muted">
          מחובר כ־<span dir="ltr">{user}</span>
        </p>
        <p className="muted" style={{ fontSize: 12.5 }}>
          שם המשתמש והסיסמה נקבעים ב־<code>.env</code> בשדות <code>AUTH_EMAIL</code> ו־
          <code>AUTH_PASSWORD</code>. שינוי של <code>AUTH_SECRET</code> מנתק את כל המחוברים.
        </p>
      </section>

      {/* ── Sender identity ─────────────────────────────────────────────── */}
      <section className="card stack">
        <h2 dir="rtl">זהות השולח</h2>
        <SenderIdentity current={appSettings} />
        <Guide k="senderIdentity" />
      </section>

      {/* ── Connections ─────────────────────────────────────────────────── */}
      <section className="card stack">
        <h2 dir="rtl">חיבורים</h2>
        <ul className="list">
          <li>
            <div className="spread">
              <span>Postgres</span>
              <Status ok={env.database} label="DATABASE_URL" />
            </div>
          </li>
          <li>
            <div className="spread">
              <span>Claude</span>
              <Status ok={env.anthropic} label="ANTHROPIC_API_KEY" />
            </div>
          </li>
          <li>
            <div className="spread">
              <span>Gmail</span>
              <Status ok={env.gmail} label="GOOGLE_CLIENT_ID / SECRET / REFRESH_TOKEN" />
            </div>
          </li>
          <li>
            <div className="spread">
              <span>חיפוש ספקים</span>
              <Status ok={env.search} label="SERPER_API_KEY או BRAVE_SEARCH_API_KEY" />
            </div>
          </li>
          <li>
            <div className="spread">
              <span>אימות כתובות מייל</span>
              <Status ok={env.verification} label="HUNTER_API_KEY — אופציונלי" />
            </div>
          </li>
        </ul>
        <p className="muted" style={{ fontSize: 12.5 }} dir="rtl">
          כל הערכים נקראים מקובץ <code>.env</code>. אחרי שינוי צריך להפעיל מחדש את השרת.
        </p>
      </section>

      {/* ── Gmail ───────────────────────────────────────────────────────── */}
      <section className="card stack">
        <h2 dir="rtl">חיבור Gmail</h2>
        <Guide k="gmail" />
        <p className="muted" style={{ fontSize: 12.5 }} dir="rtl">
          ההרשאות הנדרשות: <code dir="ltr">gmail.send</code> לשליחה,{" "}
          <code dir="ltr">gmail.readonly</code> לקריאת תשובות,{" "}
          <code dir="ltr">gmail.modify</code> לסימון כנקרא.
        </p>
      </section>

      {/* ── Domain ──────────────────────────────────────────────────────── */}
      <section className="card stack">
        <h2 dir="rtl">דומיין שליחה</h2>
        <Guide k="domain" />
      </section>

      <Link href="/" className="muted">
        ← חזרה לפרויקטים
      </Link>
    </main>
  );
}
