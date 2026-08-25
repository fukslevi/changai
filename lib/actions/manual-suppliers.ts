"use server";

import { revalidatePath } from "next/cache";
import {
  addSuppliersByUrl as addSuppliers,
  setLeadEmail as setEmail,
  type ManualState,
} from "../discovery/manual";

export type { AddedSupplier, ManualState } from "../discovery/manual";

/**
 * Thin wrappers around lib/discovery/manual.
 *
 * The rules live there so they can be tested: a server action revalidates
 * paths, which needs a rendering context, and a test that calls one only ever
 * proves that `revalidatePath` throws outside a request.
 */
export async function addSuppliersByUrl(
  prev: ManualState,
  formData: FormData,
): Promise<ManualState> {
  const projectId = String(formData.get("projectId") ?? "");
  const result = await addSuppliers(prev, formData);
  if (projectId) revalidatePath(`/projects/${projectId}`);
  return result;
}

export async function setLeadEmail(
  prev: ManualState,
  formData: FormData,
): Promise<ManualState> {
  const projectId = String(formData.get("projectId") ?? "");
  const result = await setEmail(prev, formData);
  if (projectId) revalidatePath(`/projects/${projectId}`);
  return result;
}
