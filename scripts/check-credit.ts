/**
 * The API balance, as the app sees it.
 *
 *   npx tsx --env-file=.env scripts/check-credit.ts [--force]
 *
 * --force spends a token regardless of when the last check ran.
 */
import { creditStatus, probeCredit } from "../lib/health/credit";

async function main() {
  const before = await creditStatus();
  console.log(
    `stored : ok=${before.ok} checked=${before.checkedAt?.toISOString() ?? "never"} stale=${before.stale}`,
  );

  const after = await probeCredit({ force: process.argv.includes("--force") });
  console.log(
    `now    : ok=${after.ok} checked=${after.checkedAt?.toISOString() ?? "never"}`,
  );
  if (after.message) console.log(`message: ${after.message.slice(0, 200)}`);
  console.log(
    after.ok === true
      ? "\nיש אשראי - המערכת יכולה לעבד התכתבויות"
      : after.ok === false
        ? "\nאין אשראי - המערכת לא מעבדת התכתבויות"
        : "\nלא נבדק",
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
