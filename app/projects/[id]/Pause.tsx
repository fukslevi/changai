"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  toggleProjectArchived,
  toggleProjectPaused,
  type PauseState,
} from "@/lib/actions/pause";

function Submit({ label, title }: { label: string; title: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="ghost" disabled={pending} title={title}>
      {pending ? "…" : label}
    </button>
  );
}

function Note({ state }: { state: PauseState }) {
  if (state.error) return <span className="bad" style={{ fontSize: 12 }}>{state.error}</span>;
  if (!state.ok) return null;
  return (
    <span className="muted" style={{ fontSize: 12, maxWidth: 340, textAlign: "right" }}>
      {state.ok}
    </span>
  );
}

/**
 * The off switch and the archive, next to the status.
 *
 * They sit with the status tags rather than down in settings because they are
 * the answer to a question you ask while looking at the status - "this one is
 * chasing eleven suppliers and I have moved on" - and a switch you have to go
 * and find is a switch that does not get used.
 *
 * Off and archived are deliberately two controls rather than one: off is a
 * decision about this week, archived is a decision about the product. While a
 * project is archived the off switch is hidden, because it is already off and
 * a second control claiming otherwise would just be a way to get it wrong.
 */
export function Pause({
  projectId,
  pausedAt,
  archivedAt,
}: {
  projectId: string;
  pausedAt: Date | null;
  archivedAt: Date | null;
}) {
  const [pauseState, pauseAction] = useActionState<PauseState, FormData>(toggleProjectPaused, {});
  const [archiveState, archiveAction] = useActionState<PauseState, FormData>(
    toggleProjectArchived,
    {},
  );

  const paused = Boolean(pausedAt);
  const archived = Boolean(archivedAt);

  return (
    <div className="stack" style={{ gap: 4, alignItems: "flex-end" }} dir="rtl">
      <div className="row" style={{ gap: 6 }}>
        {!archived && (
          <form action={pauseAction}>
            <input type="hidden" name="projectId" value={projectId} />
            <Submit
              label={paused ? "הדלק פרויקט" : "כבה פרויקט"}
              title={
                paused
                  ? "הדלקה: המחזור הבא ימשיך מאיפה שהפסיק"
                  : "כיבוי: לא נשלח כלום, לא נקרא כלום, לא נשלחות תזכורות"
              }
            />
          </form>
        )}

        <form action={archiveAction}>
          <input type="hidden" name="projectId" value={projectId} />
          <Submit
            label={archived ? "שחזר מארכיון" : "העבר לארכיון"}
            title={
              archived
                ? "מחזיר את הפרויקט לרשימה. הוא יישאר כבוי עד שתדליק אותו"
                : "מוציא את הפרויקט מהרשימה ומכבה אותו. שום דבר לא נמחק"
            }
          />
        </form>
      </div>

      <Note state={pauseState} />
      <Note state={archiveState} />
    </div>
  );
}
