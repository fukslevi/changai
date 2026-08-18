"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  generateOutreachEmail,
  saveOutreachEmail,
  type OutreachState,
} from "@/lib/actions/outreach";

function Submit({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}>
      {pending ? pendingLabel : label}
    </button>
  );
}

function GhostSubmit({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="ghost" disabled={pending}>
      {pending ? pendingLabel : label}
    </button>
  );
}

function Feedback({ state }: { state: OutreachState }) {
  if (state.error) return <p className="error">{state.error}</p>;
  if (state.ok) return <p style={{ color: "var(--ok)", fontSize: 13 }}>{state.ok}</p>;
  return null;
}

export function OutreachEmail({
  projectId,
  subject,
  body,
  canGenerate,
}: {
  projectId: string;
  subject: string | null;
  body: string | null;
  canGenerate: boolean;
}) {
  const [genState, generate] = useActionState<OutreachState, FormData>(
    generateOutreachEmail,
    {},
  );
  const [saveState, save] = useActionState<OutreachState, FormData>(saveOutreachEmail, {});

  if (!body) {
    return (
      <form action={generate} className="stack">
        <input type="hidden" name="projectId" value={projectId} />
        <p className="muted">
          {canGenerate
            ? "Built from the parsed RFQ — quantities, packaging, certification and any quality issues from previous production all come from the document."
            : "Parse the RFQ first. The email is generated from it, not written by hand, so that it cannot drift from the specification."}
        </p>
        <Feedback state={genState} />
        <div className="row">
          <Submit label="Generate email" pendingLabel="Generating…" />
        </div>
      </form>
    );
  }

  return (
    <div className="stack">
      <form action={save} className="stack">
        <input type="hidden" name="projectId" value={projectId} />
        <div>
          <label htmlFor="subject">Subject</label>
          <input id="subject" name="subject" type="text" defaultValue={subject ?? ""} required />
        </div>
        <div>
          <label htmlFor="body">Body</label>
          <textarea
            id="body"
            name="body"
            rows={26}
            defaultValue={body}
            required
            style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12.5 }}
          />
          <p className="hint">
            <code>{"{{company}}"}</code> is replaced with each supplier&apos;s name at send time.
            Every supplier gets their own message — never a shared BCC, which reads as bulk mail
            to spam filters and cannot be tracked per supplier.
          </p>
        </div>
        <Feedback state={saveState} />
        <div className="row">
          <Submit label="Save" pendingLabel="Saving…" />
        </div>
      </form>

      <form action={generate}>
        <input type="hidden" name="projectId" value={projectId} />
        <div className="row">
          <GhostSubmit label="Regenerate from RFQ" pendingLabel="Regenerating…" />
          <span className="muted">Discards manual edits</span>
        </div>
        <Feedback state={genState} />
      </form>
    </div>
  );
}
