/**
 * What do bounces look like in this mailbox, if any are there?
 *
 * Designing the detector from documentation would be guessing. Gmail exposes
 * failures three different ways and it matters which of them actually occur
 * here: a DSN from mailer-daemon, Gmail's own "Address not found", or a soft
 * failure that never bounces at all and simply goes nowhere.
 *
 * Read-only. Nothing is stored.
 */
import { gmailClient } from "../lib/mail/gmail";

const QUERIES = [
  "from:mailer-daemon",
  "from:postmaster",
  'subject:"Delivery Status Notification"',
  'subject:"Address not found"',
  'subject:"Undelivered Mail Returned to Sender"',
  "label:^failed",
];

async function main() {
  const gmail = gmailClient();

  for (const q of QUERIES) {
    const list = await gmail.users.messages.list({ userId: "me", q, maxResults: 10 });
    const found = list.data.messages ?? [];
    console.log(`\n=== ${q} -> ${found.length} ===`);

    for (const stub of found.slice(0, 4)) {
      const full = await gmail.users.messages.get({
        userId: "me",
        id: stub.id as string,
        format: "full",
      });

      const headers = full.data.payload?.headers ?? [];
      const header = (name: string) =>
        headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";

      console.log(`  from:    ${header("From")}`);
      console.log(`  subject: ${header("Subject")}`);
      console.log(`  date:    ${header("Date")}`);
      console.log(`  thread:  ${full.data.threadId}`);
      console.log(`  snippet: ${(full.data.snippet ?? "").slice(0, 220)}`);

      // The machine-readable part, when there is one.
      const parts = full.data.payload?.parts ?? [];
      for (const part of parts) {
        if (part.mimeType?.includes("delivery-status") || part.mimeType?.includes("rfc822-headers")) {
          const data = part.body?.data;
          if (!data) continue;
          const text = Buffer.from(data, "base64").toString("utf8");
          console.log(`  [${part.mimeType}]`);
          console.log(
            text
              .split("\n")
              .filter((line) => /Status|Action|Final-Recipient|Original-Recipient|Diagnostic|To:/i.test(line))
              .map((line) => `    ${line.trim()}`)
              .join("\n"),
          );
        }
      }
      console.log("");
    }
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
