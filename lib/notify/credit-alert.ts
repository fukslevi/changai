/**
 * Tell a person, by mail, when the agent has stopped being able to think.
 *
 * The alert goes over Gmail, which is deliberate and is the only reason this
 * works at all: an empty Anthropic balance takes out every model call in the
 * system, so anything that needed the model to notice or to phrase the warning
 * would be silenced by the very fault it is reporting.
 *
 * Daily, not hourly. The cycle runs every two hours and the condition persists
 * until somebody pays, so an alert per cycle would be twelve mails a day
 * telling you the same thing - which is how people learn to filter alerts.
 */
import { creditAlertedAt, creditStatus, markCreditAlerted } from "../health/credit";
import { notificationRecipient } from "./dispatch";
import { sendEmail } from "../mail/gmail";

const ALERT_EVERY_MS = 24 * 60 * 60 * 1000;

export interface CreditAlertResult {
  alerted: boolean;
  reason: string;
}

export async function alertIfNoCredit(): Promise<CreditAlertResult> {
  const status = await creditStatus();
  if (status.ok !== false) return { alerted: false, reason: "credit ok" };

  const last = await creditAlertedAt();
  if (last && Date.now() - last.getTime() < ALERT_EVERY_MS) {
    return { alerted: false, reason: "already alerted today" };
  }

  const to = await notificationRecipient();
  const when = status.checkedAt
    ? status.checkedAt.toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" })
    : "לא ידוע";

  await sendEmail({
    to,
    fromName: "ChangAI",
    subject: "ChangAI - נגמר האשראי ב-Anthropic API",
    body: [
      "המערכת הפסיקה לעבוד על התכתבויות עם ספקים.",
      "",
      `נבדק לאחרונה: ${when}`,
      "",
      "מה מושבת כרגע:",
      "  - קריאת תשובות של ספקים וסיווג שלהן",
      "  - כתיבת תשובות ובקשות מחיר",
      "  - חיפוש וניקוד של ספקים חדשים",
      "  - פענוח מסמכי RFQ חדשים",
      "",
      "מה ממשיך לעבוד:",
      "  - שליחת פניות ראשונות לספקים שכבר אושרו",
      "  - האתר עצמו, הטבלאות והנתונים הקיימים",
      "",
      "זאת הסיבה שהמערכת יכולה להיראות תקינה לגמרי בזמן שהיא עצורה.",
      "",
      "לתיקון: להוסיף אשראי ב-Plans & Billing בחשבון ה-Anthropic.",
      "הבדיקה רצה אוטומטית, וברגע שיהיה אשראי המצב יתעדכן לבד בעמוד הראשי.",
      "",
      status.message ? `הודעת השגיאה מה-API:\n${status.message}` : "",
    ].join("\n"),
  });

  await markCreditAlerted();
  return { alerted: true, reason: `sent to ${to}` };
}
