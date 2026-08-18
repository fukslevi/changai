import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "./session-cookie";

export { SESSION_COOKIE };
const MAX_AGE_SECONDS = 60 * 60 * 24 * 14;

function secret(): string {
  const value = process.env.AUTH_SECRET;
  if (!value) throw new Error("AUTH_SECRET is not set — copy .env.example to .env");
  return value;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("hex");
}

/** Constant-time compare that tolerates length differences without throwing. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function verifyCredentials(email: string, password: string): boolean {
  const expectedEmail = process.env.AUTH_EMAIL ?? "";
  const expectedPassword = process.env.AUTH_PASSWORD ?? "";
  if (!expectedEmail || !expectedPassword) return false;
  // Both compared in constant time so neither leaks by response timing.
  const emailOk = safeEqual(email.trim().toLowerCase(), expectedEmail.trim().toLowerCase());
  const passwordOk = safeEqual(password, expectedPassword);
  return emailOk && passwordOk;
}

/** `<issuedAt>.<hmac>` — no secrets in the cookie, only a signed timestamp. */
export function createSessionToken(): string {
  const issuedAt = String(Date.now());
  return `${issuedAt}.${sign(issuedAt)}`;
}

export function isValidSessionToken(token: string | undefined): boolean {
  if (!token) return false;
  const [issuedAt, signature] = token.split(".");
  if (!issuedAt || !signature) return false;
  if (!safeEqual(signature, sign(issuedAt))) return false;
  const age = (Date.now() - Number(issuedAt)) / 1000;
  return Number.isFinite(age) && age >= 0 && age < MAX_AGE_SECONDS;
}

export async function startSession() {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, createSessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function endSession() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

export async function currentUser(): Promise<string | null> {
  const jar = await cookies();
  return isValidSessionToken(jar.get(SESSION_COOKIE)?.value)
    ? (process.env.AUTH_EMAIL ?? null)
    : null;
}
