import type { CreditStatus } from "@/lib/health/credit";

/**
 * The state of the API balance, in a colour, at the top of the page.
 *
 * It is a banner rather than a line of muted text because of how the fault
 * presents: nothing breaks visibly. Pages load, tables render, mail still goes
 * out. On 28.08 the balance emptied and the only symptom on screen was a
 * last-cycle time that looked like a late schedule. A warning that has to be
 * inferred from a timestamp is not a warning.
 *
 * Green is stated rather than implied. "No news is good news" fails exactly
 * when the checker itself has stopped, and a green line with a time on it is
 * the difference between "checked, fine" and "nobody has looked".
 */
export function CreditBanner({ status }: { status: CreditStatus }) {
  const when = status.checkedAt
    ? status.checkedAt.toLocaleString("he-IL", {
        timeZone: "Asia/Jerusalem",
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  if (status.ok === false) {
    return (
      <section
        dir="rtl"
        style={{
          border: "2px solid var(--bad)",
          background: "var(--bad)",
          color: "#fff",
          borderRadius: "var(--radius)",
          padding: "12px 14px",
        }}
      >
        <div style={{ fontWeight: 700, fontSize: 15 }}>
          ● נגמר האשראי ב-Anthropic API - המערכת לא מעבדת התכתבויות
        </div>
        <div style={{ fontSize: 13, marginTop: 6, opacity: 0.95 }}>
          לא נקראות תשובות מספקים, לא נכתבות תשובות, לא מתבצע חיפוש ספקים ולא
          נפענחים מסמכי RFQ. שליחת פניות ראשונות לספקים שכבר אושרו ממשיכה לעבוד -
          ולכן המערכת נראית תקינה.
        </div>
        <div style={{ fontSize: 13, marginTop: 6, fontWeight: 600 }}>
          לתיקון: להוסיף אשראי ב-Plans &amp; Billing בחשבון Anthropic. הבדיקה רצה
          לבד וברגע שיהיה אשראי השורה הזאת תהפוך לירוקה.
        </div>
        {when && (
          <div style={{ fontSize: 12, marginTop: 6, opacity: 0.85 }}>נבדק: {when}</div>
        )}
      </section>
    );
  }

  if (status.ok === null) {
    return (
      <section
        dir="rtl"
        style={{
          border: "1px solid var(--warn)",
          borderRadius: "var(--radius)",
          padding: "9px 12px",
          color: "var(--warn)",
          fontSize: 13,
        }}
      >
        ● מצב האשראי ב-Anthropic API עוד לא נבדק - הבדיקה תרוץ במחזור הקרוב
      </section>
    );
  }

  return (
    <section
      dir="rtl"
      style={{
        border: "1px solid var(--ok)",
        borderRadius: "var(--radius)",
        padding: "9px 12px",
        color: "var(--ok)",
        fontSize: 13,
        display: "flex",
        justifyContent: "space-between",
        gap: 10,
        flexWrap: "wrap",
      }}
    >
      <span style={{ fontWeight: 600 }}>● יש אשראי ב-Anthropic API - המערכת פעילה</span>
      {when && (
        <span style={{ opacity: 0.8 }}>
          נבדק {when}
          {status.stale ? " · הבדיקה מתעדכנת כל 24 שעות" : ""}
        </span>
      )}
    </section>
  );
}
