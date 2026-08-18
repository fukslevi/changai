"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  updateProject,
  uploadRfq,
  type ProjectFormState,
} from "@/lib/actions/projects";
import { parseProjectRfq, type ParseState } from "@/lib/actions/rfq";

function Submit({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}>
      {pending ? pendingLabel : label}
    </button>
  );
}

function Feedback({ state }: { state: ProjectFormState }) {
  if (state.error) return <p className="error">{state.error}</p>;
  if (state.ok) return <p style={{ color: "var(--ok)", fontSize: 13 }}>{state.ok}</p>;
  return null;
}

export function EditDetails({
  projectId,
  name,
  keywords,
}: {
  projectId: string;
  name: string;
  keywords: string[];
}) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState<ProjectFormState, FormData>(updateProject, {});

  if (!open) {
    return (
      <button className="ghost" onClick={() => setOpen(true)}>
        Edit details
      </button>
    );
  }

  return (
    <form action={action} className="stack" style={{ width: "100%" }}>
      <input type="hidden" name="projectId" value={projectId} />

      <div>
        <label htmlFor="name">Product name</label>
        <input id="name" name="name" type="text" defaultValue={name} required />
        <p className="hint">
          The generic term manufacturers list under — not the marketing name.
        </p>
      </div>

      <div>
        <label htmlFor="keywords">Keywords</label>
        <textarea
          id="keywords"
          name="keywords"
          rows={6}
          defaultValue={keywords.join("\n")}
          required
        />
        <p className="hint">
          One per line. These drive supplier discovery — cover material variants
          (<code>metal</code>, <code>steel wire</code>) and include at least one line ending in{" "}
          <code>manufacturer</code> or <code>factory</code>.
        </p>
      </div>

      <Feedback state={state} />

      <div className="row">
        <Submit label="Save" pendingLabel="Saving…" />
        <button type="button" className="ghost" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>
    </form>
  );
}

export function ParseRfq({ projectId, parsed }: { projectId: string; parsed: boolean }) {
  const [state, action] = useActionState<ParseState, FormData>(parseProjectRfq, {});

  return (
    <form action={action} className="stack">
      <input type="hidden" name="projectId" value={projectId} />
      <div className="row">
        <Submit
          label={parsed ? "Re-parse RFQ" : "Parse RFQ"}
          pendingLabel="Reading the document…"
        />
        <span className="muted">
          Extracts items, requirements, quantity tiers and target prices
        </span>
      </div>
      <Feedback state={state} />
    </form>
  );
}

export function UploadRfq({ projectId, hasRfq }: { projectId: string; hasRfq: boolean }) {
  const [state, action] = useActionState<ProjectFormState, FormData>(uploadRfq, {});

  return (
    <form action={action} className="stack">
      <input type="hidden" name="projectId" value={projectId} />
      <div>
        <label htmlFor="rfq">{hasRfq ? "Replace RFQ" : "Upload RFQ"}</label>
        <input id="rfq" name="rfq" type="file" accept=".pdf,.docx,.pptx" required />
        <p className="hint">
          PDF, PPTX or DOCX up to 15MB. Must include dimensions, materials and product photos —
          specifications, target prices and quantity tiers are all read from this file.
        </p>
      </div>
      <Feedback state={state} />
      <div className="row">
        <Submit label={hasRfq ? "Replace" : "Upload"} pendingLabel="Uploading…" />
      </div>
    </form>
  );
}
