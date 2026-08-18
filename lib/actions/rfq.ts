"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, files } from "../db";
import { parseRfq } from "../rfq/parse";
import { persistExtraction } from "../rfq/persist";

export type ParseState = { error?: string; ok?: string };

export async function parseProjectRfq(
  _prev: ParseState,
  formData: FormData,
): Promise<ParseState> {
  const projectId = String(formData.get("projectId") ?? "");
  if (!projectId) return { error: "Missing project" };

  const [file] = await db
    .select()
    .from(files)
    .where(and(eq(files.projectId, projectId), eq(files.kind, "rfq")))
    .limit(1);

  if (!file) return { error: "Upload an RFQ first" };

  let summary;
  try {
    const { extraction } = await parseRfq({
      filename: file.filename,
      mimeType: file.mimeType,
      content: file.content,
    });
    summary = await persistExtraction(projectId, extraction);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Parsing failed" };
  }

  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/");

  return {
    ok:
      `Parsed ${summary.items} items and ${summary.requirements} requirements` +
      (summary.issues > 0
        ? ` · ${summary.issues} issue${summary.issues === 1 ? "" : "s"} found in the RFQ`
        : ""),
  };
}
