/**
 * Ask Gmail what actually went out, for when the local record says "queued".
 *
 *   npx tsx --env-file=.env scripts/check-sent.ts lumi@lumi.cn
 *
 * A queued row means a send started and its outcome was never written back.
 * The mailbox is the only authority on whether the message left.
 */
import { gmailClient } from "../lib/mail/gmail";

async function main() {
  const address = process.argv[2];
  if (!address) throw new Error("Usage: check-sent.ts <recipient>");

  const gmail = gmailClient();
  const list = await gmail.users.messages.list({
    userId: "me",
    q: `in:sent to:${address}`,
    maxResults: 10,
  });

  const found = list.data.messages ?? [];
  if (found.length === 0) {
    console.log(`Nothing in Sent addressed to ${address} - the message did not go out.`);
    process.exit(0);
  }

  for (const item of found) {
    const message = await gmail.users.messages.get({
      userId: "me",
      id: item.id as string,
      format: "metadata",
      metadataHeaders: ["To", "Subject", "Date"],
    });
    const headers = Object.fromEntries(
      (message.data.payload?.headers ?? []).map((h) => [h.name, h.value]),
    );
    console.log(
      `${message.data.id}  thread=${message.data.threadId}\n` +
        `  To     : ${headers.To}\n  Subject: ${headers.Subject}\n  Date   : ${headers.Date}`,
    );
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(`\n${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
});
