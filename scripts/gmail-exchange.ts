/**
 * Exchange an authorisation code for a refresh token, and write it to .env.
 *
 *   npx tsx --env-file=.env scripts/gmail-exchange.ts "<code or full redirect URL>"
 *
 * Use this when the consent screen redirected to localhost but the listener in
 * gmail-auth.ts was not running — the code is still sitting in the browser's
 * address bar. Codes are single-use and expire in about ten minutes.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { google } from "googleapis";

const REDIRECT_URI = "http://localhost:53682";

/** Accepts a bare code or the whole redirect URL pasted from the address bar. */
function extractCode(input: string): string {
  if (!input.includes("://")) return input.trim();
  const code = new URL(input).searchParams.get("code");
  if (!code) throw new Error("No ?code= parameter in that URL");
  return code;
}

/** Replace the line if present, append it if not. */
function upsertEnv(key: string, value: string) {
  const current = readFileSync(".env", "utf8");
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  writeFileSync(
    ".env",
    pattern.test(current) ? current.replace(pattern, line) : `${current.trimEnd()}\n${line}\n`,
    "utf8",
  );
}

async function main() {
  const raw = process.argv[2];
  if (!raw) throw new Error("Pass the authorisation code or the full redirect URL");

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("GOOGLE_CLIENT_ID / SECRET missing from .env");

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);
  const { tokens } = await oauth2.getToken(extractCode(raw));

  if (!tokens.refresh_token) {
    throw new Error(
      "No refresh token returned. Revoke at myaccount.google.com/permissions, then authorise again.",
    );
  }

  oauth2.setCredentials(tokens);
  const profile = await google
    .gmail({ version: "v1", auth: oauth2 })
    .users.getProfile({ userId: "me" });

  const mailbox = profile.data.emailAddress ?? "";
  upsertEnv("GOOGLE_REFRESH_TOKEN", tokens.refresh_token);
  if (mailbox) upsertEnv("SOURCING_MAILBOX", mailbox);

  console.log("─".repeat(64));
  console.log(`Authorised mailbox : ${mailbox}`);
  console.log(`Messages in mailbox: ${profile.data.messagesTotal}`);
  console.log("─".repeat(64));
  console.log("\nWritten to .env: GOOGLE_REFRESH_TOKEN, SOURCING_MAILBOX");
  console.log("Restart the dev server to pick them up.\n");

  process.exit(0);
}

main().catch((err) => {
  console.error(`\n${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
});
