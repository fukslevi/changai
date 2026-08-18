/**
 * One-time Gmail consent flow. Prints a refresh token to paste into .env.
 *
 *   npx tsx --env-file=.env scripts/gmail-auth.ts
 *
 * Sign in as the SOURCING mailbox, not the admin. The Cloud project belongs to
 * the organisation; this token belongs to the mailbox it is granted from, and
 * it is what the app sends and reads as.
 */
import { createServer } from "node:http";
import { google } from "googleapis";

/** Desktop OAuth clients accept any loopback port without registering it. */
const PORT = 53682;
const REDIRECT_URI = `http://localhost:${PORT}`;

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.send", // send outreach
  "https://www.googleapis.com/auth/gmail.readonly", // read supplier replies
  "https://www.googleapis.com/auth/gmail.modify", // mark handled, apply labels
];

async function main() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set in .env");
  }

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);

  const url = oauth2.generateAuthUrl({
    access_type: "offline", // without this Google returns no refresh token
    prompt: "consent", // force a fresh one even if already authorised once
    scope: SCOPES,
  });

  console.log("\nOpen this URL and sign in as the SOURCING mailbox:\n");
  console.log(url);
  console.log(`\nWaiting for the redirect on ${REDIRECT_URI} …\n`);

  const code = await new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      const params = new URL(req.url ?? "/", REDIRECT_URI).searchParams;
      const error = params.get("error");
      const authCode = params.get("code");

      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        `<body style="font:16px system-ui;padding:40px">${
          authCode ? "Authorised. You can close this tab." : `Failed: ${error ?? "no code"}`
        }</body>`,
      );

      server.close();
      if (authCode) resolve(authCode);
      else reject(new Error(error ?? "No authorisation code returned"));
    });

    server.on("error", reject);
    server.listen(PORT);
  });

  const { tokens } = await oauth2.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error(
      "Google returned no refresh token. Revoke the app at myaccount.google.com/permissions and run this again.",
    );
  }

  oauth2.setCredentials(tokens);
  const profile = await google.gmail({ version: "v1", auth: oauth2 }).users.getProfile({
    userId: "me",
  });

  console.log("─".repeat(70));
  console.log(`Authorised mailbox : ${profile.data.emailAddress}`);
  console.log("─".repeat(70));
  console.log("\nAdd these two lines to .env:\n");
  console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
  console.log(`SOURCING_MAILBOX=${profile.data.emailAddress}`);
  console.log("\nThen restart the dev server.\n");

  process.exit(0);
}

main().catch((err) => {
  console.error(`\n${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
});
