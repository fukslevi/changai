"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { extendScreeningGoal, type PauseState } from "@/lib/actions/pause";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="ghost" disabled={pending}>
      {pending ? "…" : "מצא עוד 3 הצעות מחיר"}
    </button>
  );
}

/**
 * Shown only once a screening project has reached its quote goal and paused
 * itself - the moment the operator has to decide whether 3 offers are enough
 * or the net should go wider. A plain "turn on" is not offered here: it would
 * be paused again on the next cycle, since the goal it is checked against
 * would not have moved.
 */
export function ScreeningGoal({
  projectId,
  quotesReceived,
  quotesTarget,
}: {
  projectId: string;
  quotesReceived: number;
  quotesTarget: number;
}) {
  const [state, action] = useActionState<PauseState, FormData>(extendScreeningGoal, {});

  return (
    <div className="stack" style={{ gap: 4, alignItems: "flex-end" }} dir="rtl">
      <span className="muted" style={{ fontSize: 12.5 }}>
        {quotesReceived}/{quotesTarget} הצעות מחיר - הפרויקט הושהה אוטומטית
      </span>
      <form action={action}>
        <input type="hidden" name="projectId" value={projectId} />
        <Submit />
      </form>
      {state.error && <span className="bad" style={{ fontSize: 12 }}>{state.error}</span>}
      {state.ok && <span className="muted" style={{ fontSize: 12 }}>{state.ok}</span>}
    </div>
  );
}
