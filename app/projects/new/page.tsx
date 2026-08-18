"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Guide } from "@/app/Guide";
import { createProject, type CreateProjectState } from "@/lib/actions/projects";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}>
      {pending ? "יוצר…" : "צור פרויקט"}
    </button>
  );
}

export default function NewProjectPage() {
  const [state, action] = useActionState<CreateProjectState, FormData>(createProject, {});

  return (
    <main className="stack">
      <div className="spread">
        <h2 style={{ margin: 0 }} dir="rtl">
          פרויקט חדש
        </h2>
        <Link href="/" className="muted">
          ביטול
        </Link>
      </div>

      <form action={action} className="card stack">
        <div>
          <label htmlFor="name">Product name</label>
          <input id="name" name="name" type="text" placeholder="Rear Bike Basket" required />
          <Guide k="productName" />
        </div>

        <div>
          <label htmlFor="keywords">Keywords</label>
          <textarea
            id="keywords"
            name="keywords"
            rows={7}
            placeholder={
              "rear bike basket\nbicycle rear rack basket\nbike cargo basket\nmetal bicycle basket manufacturer\nbike basket factory china"
            }
            required
          />
          <Guide k="keywords" />
        </div>

        <div>
          <label htmlFor="rfq">RFQ document</label>
          <input id="rfq" name="rfq" type="file" accept=".pdf,.docx,.pptx" />
          <Guide k="rfqFile" />
        </div>

        {state.error && <p className="error">{state.error}</p>}

        <div className="row">
          <Submit />
        </div>
      </form>
    </main>
  );
}
