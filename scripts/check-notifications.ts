/** What the next cycle would announce, without announcing it. */
import { dispatchNotifications, notificationRecipient } from "../lib/notify/dispatch";

async function main() {
  console.log("recipient:", await notificationRecipient());

  const announcements = await dispatchNotifications({ send: false });
  if (announcements.length === 0) {
    console.log("nothing to announce");
  }
  for (const item of announcements) {
    console.log(`\n[${item.kind}] ${item.project}`);
    console.log(`  subject: ${item.subject}`);
    console.log(`  keys: ${item.keys.length}`);
    console.log(
      item.body
        .split("\n")
        .map((line) => `  | ${line}`)
        .join("\n"),
    );
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
