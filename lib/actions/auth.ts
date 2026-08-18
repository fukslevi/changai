"use server";

import { redirect } from "next/navigation";
import { endSession, startSession, verifyCredentials } from "../auth";

export type LoginState = { error?: string };

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  if (!verifyCredentials(email, password)) {
    // One message for both cases — telling the user which half was wrong
    // tells anyone else the same thing.
    return { error: "כתובת או סיסמה שגויים" };
  }

  await startSession();
  redirect("/");
}

export async function logout() {
  await endSession();
  redirect("/login");
}
