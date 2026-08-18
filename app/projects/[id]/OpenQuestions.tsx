"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  answerQuestion,
  dismissQuestion,
  previewAutopilot,
  runAutopilotAction,
  type AutopilotState,
} from "@/lib/actions/autopilot";

export interface QuestionRow {
  id: string;
  kind: "supplier" | "commercial";
  company: string | null;
  scope: "project" | "supplier";
  questionHe: string;
  whyHe: string | null;
  unit?: string;
}

export interface AnsweredRow {
  id: string;
  questionHe: string;
  answer: string;
}

function Submit({
  label,
  pendingLabel,
  ghost,
}: {
  label: string;
  pendingLabel: string;
  ghost?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={ghost ? "ghost" : undefined} disabled={pending}>
      {pending ? pendingLabel : label}
    </button>
  );
}

function Feedback({ state }: { state: AutopilotState }) {
  if (state.error) return <p className="error">{state.error}</p>;
  if (state.ok) return <p style={{ color: "var(--ok)", fontSize: 13 }}>{state.ok}</p>;
  return null;
}

function Question({ projectId, row }: { projectId: string; row: QuestionRow }) {
  const [answerState, answer] = useActionState<AutopilotState, FormData>(answerQuestion, {});
  const [dismissState, dismiss] = useActionState<AutopilotState, FormData>(dismissQuestion, {});

  const isNumber = row.kind === "commercial";

  return (
    <li>
      <div className="spread">
        <strong style={{ fontWeight: 600 }}>{row.questionHe}</strong>
        <span className="tag">
          {row.kind === "commercial"
            ? "נדרש כדי לשלוח"
            : row.scope === "project"
              ? "כל הספקים"
              : row.company}
        </span>
      </div>

      {row.whyHe && (
        <p className="muted" style={{ margin: "4px 0 0", fontSize: 12.5 }}>
          {row.whyHe}
        </p>
      )}

      <form action={answer} className="stack" style={{ gap: 6, marginTop: 8 }}>
        <input type="hidden" name="projectId" value={projectId} />
        <input type="hidden" name="questionId" value={row.id} />

        {isNumber ? (
          <div className="row" style={{ gap: 6 }}>
            <input
              name="answer"
              type="number"
              step="0.00001"
              min="0"
              dir="ltr"
              placeholder={row.unit}
              style={{ width: 140 }}
            />
            <Submit label="שמור" pendingLabel="…" />
          </div>
        ) : (
          <>
            <textarea
              name="answer"
              rows={2}
              placeholder="התשובה שלך - תיכנס לכל התכתבות שצריכה אותה"
              style={{ width: "100%", fontFamily: "inherit", fontSize: 13 }}
            />
            <div className="row">
              <Submit label="ענה והמשך" pendingLabel="שולח…" />
              <label className="row" style={{ gap: 4, fontSize: 12.5 }}>
                <input type="checkbox" name="alsoSend" defaultChecked />
                <span className="muted">שלח מיד לספקים שממתינים</span>
              </label>
              <button
                type="submit"
                className="ghost"
                formAction={dismiss}
                title="השאלה לא רלוונטית - השיחה תמשיך בלעדיה"
              >
                לא רלוונטי
              </button>
            </div>
          </>
        )}

        <Feedback state={answerState} />
        <Feedback state={dismissState} />
      </form>
    </li>
  );
}

const ACTION_LABEL: Record<string, string> = {
  reply: "ייענה אוטומטית",
  park: "יעלה שאלה אליך",
  hold: "יחכה להחלטה שלך",
};

const ACTION_COLOUR: Record<string, string> = {
  reply: "var(--ok)",
  park: "var(--accent)",
  hold: "var(--bad)",
};

export function OpenQuestions({
  projectId,
  questions,
  answered,
  awaitingReply,
}: {
  projectId: string;
  questions: QuestionRow[];
  answered: AnsweredRow[];
  /** Conversations where a supplier is waiting on us right now. */
  awaitingReply: number;
}) {
  const [previewState, preview] = useActionState<AutopilotState, FormData>(previewAutopilot, {});
  const [runState, run] = useActionState<AutopilotState, FormData>(runAutopilotAction, {});

  return (
    <div className="stack" dir="rtl">
      {questions.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          אין שאלות פתוחות.
        </p>
      ) : (
        <ul className="list">
          {questions.map((q) => (
            <Question key={q.id} projectId={projectId} row={q} />
          ))}
        </ul>
      )}

      {awaitingReply > 0 && (
        <div className="row">
          <form action={run}>
            <input type="hidden" name="projectId" value={projectId} />
            <Submit label={`ענה ל-${awaitingReply} ספקים`} pendingLabel="עונה…" />
          </form>
          <form action={preview}>
            <input type="hidden" name="projectId" value={projectId} />
            <Submit label="הצג קודם" pendingLabel="בודק…" ghost />
          </form>
          <span
            className="muted"
            style={{ fontSize: 12.5 }}
            title="מיקוח על מחיר, הצעות מחיר שהגיעו בקובץ, ושינויי מפרט לא נענים אוטומטית לעולם"
          >
            מה לא נענה לבד ⓘ
          </span>
        </div>
      )}

      <Feedback state={previewState} />
      <Feedback state={runState} />

      {previewState.preview && previewState.preview.length > 0 && (
        <ul className="list">
          {previewState.preview.map((p, i) => (
            <li key={`${p.company}-${i}`}>
              <div className="spread">
                <strong>{p.company}</strong>
                <span style={{ color: ACTION_COLOUR[p.action], fontSize: 13 }}>
                  {ACTION_LABEL[p.action]}
                </span>
              </div>
              <pre
                dir={p.action === "reply" ? "ltr" : "rtl"}
                style={{
                  whiteSpace: "pre-wrap",
                  fontSize: 12.5,
                  margin: "6px 0 0",
                  fontFamily: "inherit",
                  color: "var(--muted)",
                }}
              >
                {p.detail}
              </pre>
            </li>
          ))}
        </ul>
      )}

      {answered.length > 0 && (
        <details>
          <summary className="muted" style={{ cursor: "pointer", fontSize: 13 }}>
            {answered.length} החלטות שכבר נענו - חלות על כל ספק חדש
          </summary>
          <ul className="list" style={{ marginTop: 8 }}>
            {answered.map((q) => (
              <li key={q.id}>
                <div className="muted" style={{ fontSize: 12.5 }}>
                  {q.questionHe}
                </div>
                <div>{q.answer}</div>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
