"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  markHandled,
  refreshInbox,
  replyToSupplier,
  suggestReply,
  type InboxState,
} from "@/lib/actions/inbox";
import { GAP_LABELS } from "@/lib/inbox/labels";

export interface ThreadMessage {
  id: string;
  direction: "inbound" | "outbound";
  subject: string | null;
  bodyText: string | null;
  attachments: { filename: string; mimeType: string; storagePath: string }[];
  classification: string | null;
  analysis: {
    summary_he: string;
    questions_from_supplier: string[];
    answered: string[];
    missing: string[];
    challenges_a_requirement: boolean;
    challenge_detail: string | null;
    needs_human: boolean;
    needs_human_reason: string | null;
  } | null;
  handledAt: Date | null;
  receivedAt: Date;
}

export interface SupplierThread {
  supplierId: string;
  company: string;
  email: string | null;
  website: string | null;
  matchScore: number | null;
  messages: ThreadMessage[];
}

const STATUS_LABEL: Record<string, string> = {
  quotation: "הצעת מחיר",
  interested_needs_info: "מעוניין - שאל שאלה",
  acknowledged: "אישר קבלה",
  declined: "סירב",
  not_relevant: "לא רלוונטי",
  unclassified: "לא סווג",
};

const STATUS_COLOUR: Record<string, string> = {
  quotation: "var(--ok)",
  interested_needs_info: "var(--accent)",
  acknowledged: "var(--muted)",
  declined: "var(--bad)",
  not_relevant: "var(--muted)",
};

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

function Feedback({ state }: { state: InboxState }) {
  if (state.error) return <p className="error">{state.error}</p>;
  if (state.ok) return <p style={{ color: "var(--ok)", fontSize: 13 }}>{state.ok}</p>;
  return null;
}

function timeOf(value: Date): string {
  return new Date(value).toLocaleString("he-IL", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** One supplier: the whole exchange, the triage, and the reply box. */
function Thread({ projectId, thread }: { projectId: string; thread: SupplierThread }) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [draftState, draft] = useActionState<InboxState, FormData>(suggestReply, {});
  const [sendState, send] = useActionState<InboxState, FormData>(replyToSupplier, {});
  const [handleState, handle] = useActionState<InboxState, FormData>(markHandled, {});

  const lastInbound = [...thread.messages].reverse().find((m) => m.direction === "inbound");
  const analysis = lastInbound?.analysis ?? null;
  const status = lastInbound?.classification ?? "unclassified";
  const stillOpen = Boolean(lastInbound && !lastInbound.handledAt);

  /*
   * Once we have answered, the ball is with the supplier. Drafting again would
   * produce a reply to a message we already replied to - which reads to the
   * factory as either a mistake or pressure, and neither helps.
   */
  const lastMessage = thread.messages[thread.messages.length - 1];
  const awaitingSupplier = lastMessage?.direction === "outbound";

  // The action returns the draft; the textarea holds whatever the operator has
  // typed since. Preferring their text keeps edits from being wiped on rerender.
  const text = body || draftState.draft || "";

  return (
    <li
      style={{
        borderRight: stillOpen ? "3px solid var(--accent)" : undefined,
        paddingRight: stillOpen ? 10 : 0,
      }}
    >
      <div className="spread">
        <div>
          <strong>{thread.company}</strong>{" "}
          <span className="tag" style={{ color: STATUS_COLOUR[status] }}>
            {STATUS_LABEL[status] ?? status}
          </span>
          {analysis?.needs_human && stillOpen && (
            <span className="tag" style={{ color: "var(--bad)" }}>
              דורש אותך
            </span>
          )}
          <div className="muted" style={{ marginTop: 2 }} dir="ltr">
            {thread.email}
          </div>
        </div>
        <span className="muted">{lastInbound ? timeOf(lastInbound.receivedAt) : ""}</span>
      </div>

      {analysis && (
        <div className="stack" style={{ gap: 4, marginTop: 8 }}>
          <p style={{ margin: 0 }}>{analysis.summary_he}</p>

          {analysis.challenges_a_requirement && (
            <p className="bad" style={{ margin: 0, fontSize: 13 }}>
              חולק על דרישה: {analysis.challenge_detail}
            </p>
          )}

          {analysis.questions_from_supplier.length > 0 && (
            <div className="muted" style={{ fontSize: 13 }}>
              שאל: {analysis.questions_from_supplier.join(" · ")}
            </div>
          )}

          {analysis.missing.length > 0 && (
            <div className="muted" style={{ fontSize: 12.5 }}>
              עדיין חסר: {analysis.missing.map((m) => GAP_LABELS[m] ?? m).join(" · ")}
            </div>
          )}

          {analysis.needs_human_reason && stillOpen && (
            <div style={{ fontSize: 12.5, color: "var(--bad)" }}>{analysis.needs_human_reason}</div>
          )}
        </div>
      )}

      {lastInbound && lastInbound.attachments.length > 0 && (
        <div className="muted" style={{ marginTop: 6, fontSize: 12.5 }}>
          קבצים: {lastInbound.attachments.map((a) => a.filename).join(" · ")}
        </div>
      )}

      <div className="row" style={{ marginTop: 10 }}>
        <button type="button" className="ghost" onClick={() => setOpen((v) => !v)}>
          {open ? "סגור" : "הצג התכתבות (" + thread.messages.length + ")"}
        </button>

        {awaitingSupplier ? (
          <span className="muted" style={{ fontSize: 12.5 }} title="ענינו אחרונים. אין למה להגיב עד שהם יכתבו.">
            ממתינים לתשובת הספק
          </span>
        ) : (
          <form action={draft}>
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="supplierId" value={thread.supplierId} />
            <Submit label="נסח לי תשובה" pendingLabel="מנסח…" ghost />
          </form>
        )}

        {stillOpen && lastInbound && (
          <form action={handle}>
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="messageId" value={lastInbound.id} />
            <Submit label="סמן כטופל" pendingLabel="…" ghost />
          </form>
        )}
      </div>

      <Feedback state={draftState} />
      <Feedback state={handleState} />

      {open && (
        <ul className="list" style={{ marginTop: 8 }}>
          {thread.messages.map((m) => (
            <li key={m.id}>
              <div className="spread">
                <span className="muted">{m.direction === "inbound" ? "הספק" : "אנחנו"}</span>
                <span className="muted">{timeOf(m.receivedAt)}</span>
              </div>
              <pre
                dir="ltr"
                style={{
                  whiteSpace: "pre-wrap",
                  fontSize: 12.5,
                  margin: "6px 0 0",
                  fontFamily: "inherit",
                }}
              >
                {(m.bodyText ?? "").slice(0, 2500)}
              </pre>
            </li>
          ))}
        </ul>
      )}

      {(text || (open && !awaitingSupplier)) && (
        <form action={send} className="stack" style={{ gap: 6, marginTop: 10 }}>
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="supplierId" value={thread.supplierId} />
          <textarea
            name="body"
            dir="ltr"
            rows={10}
            value={text}
            onChange={(e) => setBody(e.target.value)}
            placeholder="התשובה שתישלח לספק"
            style={{ width: "100%", fontFamily: "inherit", fontSize: 13 }}
          />
          <div className="row">
            <Submit label="שלח תשובה" pendingLabel="שולח…" />
            <span className="muted" style={{ fontSize: 12.5 }}>
              נשלח על אותו שרשור, עם החתימה שלך
            </span>
          </div>
          <Feedback state={sendState} />
        </form>
      )}
    </li>
  );
}

export function Conversations({
  projectId,
  threads,
}: {
  projectId: string;
  threads: SupplierThread[];
}) {
  const [refreshState, refresh] = useActionState<InboxState, FormData>(refreshInbox, {});

  const replied = threads.filter((t) => t.messages.some((m) => m.direction === "inbound"));
  const quoting = replied.filter((t) => t.messages.some((m) => m.classification === "quotation"));
  const waiting = threads.length - replied.length;

  return (
    <div className="stack" dir="rtl">
      <form action={refresh}>
        <div className="row">
          <Submit label="בדוק תשובות" pendingLabel="בודק…" />
          <span className="muted">
            {replied.length} ענו · {quoting.length} עם הצעת מחיר · {waiting} טרם ענו
          </span>
        </div>
        <Feedback state={refreshState} />
      </form>

      {replied.length === 0 ? (
        <p className="muted">עדיין אין תשובות. לחצו על בדוק תשובות כדי למשוך מהתיבה.</p>
      ) : (
        <ul className="list">
          {replied.map((t) => (
            <Thread key={t.supplierId} projectId={projectId} thread={t} />
          ))}
        </ul>
      )}
    </div>
  );
}
