/**
 * What the bounce sweep sees.
 *
 * Pass --apply to actually clear the dead addresses; without it nothing is
 * written.
 */
import { bounceRate, sweepBounces } from "../lib/inbox/bounces";

async function main() {
  const apply = process.argv.includes("--apply");

  const { found, cleared } = await sweepBounces({ apply });

  const permanent = found.filter((b) => b.permanent);
  const addresses = new Set(permanent.map((b) => b.recipient));

  console.log(
    `${found.length} bounce messages · ${permanent.length} permanent · ${addresses.size} distinct addresses\n`,
  );

  for (const address of addresses) {
    const example = permanent.find((b) => b.recipient === address)!;
    const times = permanent.filter((b) => b.recipient === address).length;
    console.log(`  ${address}  (bounced ${times}x, status ${example.status ?? "-"})`);
    console.log(`    ${(example.diagnostic ?? "").slice(0, 110)}`);
  }

  console.log(`\n${cleared.length} lead addresses ${apply ? "cleared" : "would be cleared"}:`);
  for (const lead of cleared) {
    console.log(`  ${lead.company} · ${lead.email} · ${lead.reason}`);
  }

  const rate = await bounceRate();
  console.log(
    `\ndeliverability: ${rate.bounced} of ${rate.sent} messages bounced = ${rate.pct?.toFixed(1) ?? "-"}%`,
  );
  console.log(`address quality: ${rate.deadAddresses} distinct mailboxes do not exist`);
  console.log(
    rate.pct !== null && rate.pct > 5
      ? "  ABOVE the 5% line - worth acting on"
      : "  under the 5% line",
  );

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
