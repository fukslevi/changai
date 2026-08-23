"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { toggleProjectPaused, type PauseState } from "@/lib/actions/pause";

function Submit({ paused }: { paused: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="ghost"
      disabled={pending}
      title={
        paused
          ? "הדלקה: המחזור הבא ימשיך מאיפה שהפסיק"
          : "כיבוי: לא נשלח כלום, לא נקרא כלום, לא נשלחות תזכורות"
      }
    >
      {pending ? "…" : paused ? "הדלק פרויקט" : "כבה פרויקט"}
    </button>
  );
}

/**
 * The off switch, next to the status.
 *
 * Sits with the status tags rather than down in settings because it is the
 * answer to a question you ask while looking at the status - "this one is
 * chasing eleven suppliers and I have moved on, stop it" - and a switch you
 * have to go and find is a switch that does not get used.
 */
export function Pause({ projectId, pausedAt }: { projectId: string; pausedAt: Date | null }) {
  const [state, action] = useActionState<PauseState, FormData>(toggleProjectPaused, {});
  const paused = Boolean(pausedAt);

  return (
    <form action={action} className="stack" style={{ gap: 4, alignItems: "flex-end" }} dir="rtl">
      <input type="hidden" name="projectId" value={projectId} />
      <Submit paused={paused} />
      {state.error && <span className="bad" style={{ fontSize: 12 }}>{state.error}</span>}
      {state.ok && (
        <span className="muted" style={{ fontSize: 12, maxWidth: 320, textAlign: "left" }}>
          {state.ok}
        </span>
      )}
    </form>
  );
}
