"use client";

import { useEffect, useRef, useState } from "react";
import { retryFailedOutreach, sendNextOutreach } from "@/lib/actions/outreach";
import { CAMPAIGN_CONFIRMATION } from "@/lib/outreach/confirm";
import type { OutreachState } from "@/lib/actions/outreach";
import { useActionState } from "react";

export interface CampaignProps {
  projectId: string;
  pending: { companyName: string; email: string; matchScore: number | null }[];
  blocked: { companyName: string; reason: string }[];
  sent: number;
  failed: number;
  hasAttachment: boolean;
  hasEmail: boolean;
  /**
   * Commercial inputs the project is still missing. Non-empty blocks the send.
   *
   * Emailing suppliers before the walk-away price exists means running the whole
   * negotiation with no ceiling - and the target price printed in the RFQ is
   * exactly the number the model should have produced. Better to stop here than
   * to find out after eleven conversations that the price was never achievable.
   */
  missingCommercials: string[];
  /** Autonomous projects do not ask for the typed phrase. */
  autonomous: boolean;
}

/**
 * Seconds between messages. Twenty individual sends inside a minute is what a
 * bulk sender looks like; spacing them out is most of what keeps a cold run out
 * of the spam folder. Randomised so the pattern is not machine-regular.
 */
function delayMs(): number {
  return 20_000 + Math.floor(Math.random() * 25_000);
}

type LogLine = { company: string; ok: boolean; detail?: string };

export function Campaign({
  projectId,
  pending,
  blocked,
  sent,
  failed,
  hasAttachment,
  hasEmail,
  missingCommercials,
  autonomous,
}: CampaignProps) {
  const [confirmation, setConfirmation] = useState("");
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<LogLine[]>([]);
  const [remaining, setRemaining] = useState(pending.length);
  const [countdown, setCountdown] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const stopped = useRef(false);
  const [retryState, retry] = useActionState<OutreachState, FormData>(retryFailedOutreach, {});

  // Leaving the page stops the campaign; nothing keeps sending in the
  // background. What the log shows is what actually went out.
  useEffect(() => () => void (stopped.current = true), []);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  async function run() {
    stopped.current = false;
    setRunning(true);
    setError(null);

    while (!stopped.current) {
      const result = await sendNextOutreach(projectId, confirmation);

      if (result.error && !result.failedFor) {
        setError(result.error);
        break;
      }
      if (result.sentTo) setLog((l) => [...l, { company: result.sentTo!, ok: true }]);
      if (result.failedFor) {
        setLog((l) => [...l, { company: result.failedFor!, ok: false, detail: result.error }]);
      }

      setRemaining(result.remaining);
      if (result.done) break;

      const wait = delayMs();
      setCountdown(Math.round(wait / 1000));
      await new Promise((resolve) => setTimeout(resolve, wait));
    }

    setCountdown(0);
    setRunning(false);
  }

  if (!hasEmail) {
    return (
      <p className="muted" dir="rtl">
        אין עדיין מייל שמור לפרויקט. ייצרו אותו בסעיף שלמעלה לפני השליחה.
      </p>
    );
  }

  const noModel = missingCommercials.length > 0;
  const armed = !noModel && (autonomous || confirmation.trim() === CAMPAIGN_CONFIRMATION);

  return (
    <div className="stack" dir="rtl">
      <p className="muted">
        {pending.length} ספקים ממתינים לשליחה · {sent} כבר נשלחו
        {failed > 0 && ` · ${failed} נכשלו`}
      </p>

      {noModel && (
        <div className="stack" style={{ gap: 4 }}>
          <p className="bad" style={{ margin: 0 }}>
            אי אפשר לשלוח לפני שיש מודל כלכלי. חסר: {missingCommercials.join(" · ")}
          </p>
          <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>
            בלי מחיר walk-away אין קו אדום, וההתכתבות מתכנסת למחיר שהספק רוצה.
          </p>
        </div>
      )}

      {!hasAttachment && (
        <p className="bad">אין קובץ RFQ מצורף לפרויקט - המייל יישלח בלי המצגת.</p>
      )}

      {pending.length > 0 && (
        <ul className="list">
          {pending.map((r) => (
            <li key={r.email}>
              <div className="spread">
                <span>{r.companyName}</span>
                <span className="muted" dir="ltr">
                  {r.email}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {blocked.length > 0 && (
        <div>
          <p className="muted">מאושרים שלא ייכללו בשליחה:</p>
          <ul className="list">
            {blocked.map((b) => (
              <li key={b.companyName}>
                <div className="spread">
                  <span>{b.companyName}</span>
                  <span className="bad">{b.reason}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {pending.length > 0 && (
        <div className="stack" style={{ gap: 8 }}>
          {autonomous ? (
            <span className="muted">
              הפרויקט במצב אוטונומי - השליחה תצא במחזור הבא בלי אישור נוסף.
            </span>
          ) : (
            <label className="stack" style={{ gap: 4 }}>
              <span className="muted">
                כתבו <strong>{CAMPAIGN_CONFIRMATION}</strong> כדי לאשר שליחה של{" "}
                {pending.length} מיילים לחברות אמיתיות
              </span>
              <input
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                placeholder={CAMPAIGN_CONFIRMATION}
                disabled={running}
                style={{ width: 220 }}
              />
            </label>
          )}

          <div className="row">
            <button type="button" onClick={run} disabled={!armed || running}>
              {running ? "שולח…" : `שלח ל-${remaining} ספקים`}
            </button>
            {running && (
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  stopped.current = true;
                  setCountdown(0);
                }}
              >
                עצור
              </button>
            )}
            {countdown > 0 && (
              <span className="muted">המייל הבא בעוד {countdown} שניות</span>
            )}
          </div>

          <p className="muted" style={{ fontSize: 12.5 }}>
            כל ספק מקבל מייל נפרד, בהפרש של 20 עד 45 שניות. אפשר לעצור באמצע - מה שנשלח
            נשלח, והשאר יישאר ברשימה. סגירת הדף עוצרת את השליחה.
          </p>
        </div>
      )}

      {log.length > 0 && (
        <ul className="list">
          {log.map((line, i) => (
            <li key={`${line.company}-${i}`}>
              <div className="spread">
                <span>{line.company}</span>
                <span className={line.ok ? undefined : "bad"} style={line.ok ? { color: "var(--ok)" } : undefined}>
                  {line.ok ? "נשלח" : "נכשל"}
                </span>
              </div>
              {line.detail && (
                <div className="muted" style={{ fontSize: 12.5 }} dir="ltr">
                  {line.detail}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {error && <p className="error">{error}</p>}

      {failed > 0 && !running && (
        <form action={retry}>
          <input type="hidden" name="projectId" value={projectId} />
          <div className="row">
            <button type="submit" className="ghost">
              החזר {failed} כישלונות לרשימה
            </button>
          </div>
          {retryState.ok && <p style={{ color: "var(--ok)", fontSize: 13 }}>{retryState.ok}</p>}
          {retryState.error && <p className="error">{retryState.error}</p>}
        </form>
      )}
    </div>
  );
}
