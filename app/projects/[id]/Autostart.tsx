"use client";

import { useEffect, useRef, useState } from "react";
import { advanceProject, type AdvanceState } from "@/lib/actions/advance";

/**
 * Runs the setup chain the moment the project page opens.
 *
 * Everything it does is derived from the RFQ - parse it, write the outreach
 * email from what it says, search for suppliers on the keywords. None of that
 * was ever a decision, so none of it should have been a button. The operator's
 * first real involvement is the question that follows: what will this sell for.
 *
 * A step at a time, with the current one named on screen. Three minutes of
 * silence looks identical to three minutes of nothing happening.
 */
export function Autostart({ projectId, pending }: { projectId: string; pending: boolean }) {
  const [state, setState] = useState<AdvanceState | null>(null);
  const [step, setStep] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (!pending || started.current) return;
    started.current = true;

    let cancelled = false;

    (async () => {
      setStep("קורא את ה-RFQ");

      // Bounded: the chain is three steps, and a stuck one should stop rather
      // than spin. Anything beyond that is a bug, not a slow document.
      for (let i = 0; i < 6 && !cancelled; i++) {
        const data = new FormData();
        data.set("projectId", projectId);
        const result = await advanceProject({ done: false }, data);
        if (cancelled) return;

        setState(result);
        if (result.error || result.done) break;
        setStep(result.next ?? null);
      }

      if (!cancelled) {
        setStep(null);
        // The page was rendered before any of this existed; the questions and
        // the shortlist are only on the server until it refreshes.
        window.location.reload();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pending, projectId]);

  if (!pending) return null;

  return (
    <div className="card stack" dir="rtl" style={{ gap: 6 }}>
      {state?.error ? (
        <>
          <strong className="bad">ההכנה נעצרה</strong>
          <span className="muted">{state.error}</span>
        </>
      ) : (
        <>
          <strong>מכין את הפרויקט</strong>
          <span className="muted">
            {step ?? "מסיים"}
            {step ? "…" : ""}
          </span>
          <span className="muted" style={{ fontSize: 12.5 }}>
            קריאת המסמך, ניסוח מייל הפנייה וחיפוש ספקים. שתיים עד שלוש דקות, אפשר להשאיר
            את הדף פתוח.
          </span>
        </>
      )}
    </div>
  );
}
