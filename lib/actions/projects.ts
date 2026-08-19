"use server";

import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, files, projects } from "../db";

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

const CreateProject = z.object({
  name: z.string().trim().min(2, "Product name is required"),
  /** Comma- or newline-separated. Seeds supplier discovery. */
  keywords: z
    .string()
    .transform((s) =>
      s
        .split(/[,\n]/)
        .map((k) => k.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.string()).min(1, "At least one keyword is required")),
});

export type CreateProjectState = { error?: string };

export async function createProject(
  _prev: CreateProjectState,
  formData: FormData,
): Promise<CreateProjectState> {
  const rawKeywords = String(formData.get("keywords") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  if (name.length < 2) return { error: "צריך שם מוצר" };

  /*
   * Keywords used to be required, and they were the slowest field on the form
   * to fill in well. They are also the one thing here that can be guessed: a
   * factory describes itself by material and process, so the product name plus
   * a manufacturing term covers the first search. The operator can refine them
   * afterwards, when the parsed RFQ has told them what the product actually is.
   */
  const keywords =
    rawKeywords.length > 0
      ? rawKeywords.split(/\r?\n/).map((k) => k.trim()).filter(Boolean)
      : [name, `${name} manufacturer`, `${name} factory china`];

  const parsed = { data: { name, keywords } };

  const upload = formData.get("rfq");
  const hasFile = upload instanceof File && upload.size > 0;
  if (hasFile && upload.size > MAX_UPLOAD_BYTES) {
    return { error: "RFQ file is larger than 15MB" };
  }

  const projectId = randomUUID();
  const autonomous = formData.get("autonomous") === "on";

  await db.transaction(async (tx) => {
    await tx.insert(projects).values({
      id: projectId,
      name: parsed.data.name,
      keywords: parsed.data.keywords,
      status: "draft",
      // Chosen on the creation form, so the project starts in the mode the
      // operator wants rather than in the safest one they then have to change.
      autonomyTier: autonomous ? 3 : 1,
      // Read from the RFQ's own pricing table during parsing — never assumed.
      quantityTiers: [],
      sourceRfqFile: hasFile ? upload.name : null,
    });

    if (hasFile) {
      await tx.insert(files).values({
        projectId,
        filename: upload.name,
        mimeType: upload.type || "application/octet-stream",
        sizeBytes: upload.size,
        content: Buffer.from(await upload.arrayBuffer()),
        kind: "rfq",
      });
    }
  });

  revalidatePath("/");
  redirect(`/projects/${projectId}`);
}

/* ── Editing an existing project ──────────────────────────────────────────── */

export type ProjectFormState = { error?: string; ok?: string };

export async function updateProject(
  _prev: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  const projectId = String(formData.get("projectId") ?? "");
  if (!projectId) return { error: "Missing project" };

  const parsed = CreateProject.safeParse({
    name: formData.get("name"),
    keywords: formData.get("keywords"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  await db
    .update(projects)
    .set({ name: parsed.data.name, keywords: parsed.data.keywords })
    .where(eq(projects.id, projectId));

  revalidatePath("/");
  revalidatePath(`/projects/${projectId}`);
  return { ok: "Saved" };
}

/**
 * Attach (or replace) the RFQ on an existing project. Kept separate from
 * updateProject so a keyword edit never has to re-upload a 10MB deck.
 */
export async function uploadRfq(
  _prev: ProjectFormState,
  formData: FormData,
): Promise<ProjectFormState> {
  const projectId = String(formData.get("projectId") ?? "");
  if (!projectId) return { error: "Missing project" };

  const upload = formData.get("rfq");
  if (!(upload instanceof File) || upload.size === 0) {
    return { error: "Choose a file first" };
  }
  if (upload.size > MAX_UPLOAD_BYTES) {
    return { error: `File is ${Math.round(upload.size / 1024 / 1024)}MB — the limit is 15MB` };
  }

  const content = Buffer.from(await upload.arrayBuffer());

  await db.transaction(async (tx) => {
    // One RFQ per project: replace rather than accumulate versions the
    // parser would then have to disambiguate between.
    await tx.delete(files).where(and(eq(files.projectId, projectId), eq(files.kind, "rfq")));
    await tx.insert(files).values({
      projectId,
      filename: upload.name,
      mimeType: upload.type || "application/octet-stream",
      sizeBytes: upload.size,
      content,
      kind: "rfq",
    });
    await tx
      .update(projects)
      .set({ sourceRfqFile: upload.name })
      .where(eq(projects.id, projectId));
  });

  revalidatePath("/");
  revalidatePath(`/projects/${projectId}`);
  return { ok: `${upload.name} uploaded` };
}
