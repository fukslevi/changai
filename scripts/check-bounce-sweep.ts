/** What the bounce sweep sees. Dry run - changes nothing. */
import { bounceRate, sweepBounces } from "../lib/inbox/bounces";

async function main() {
  const { found, cleared } = await sweepBounces({ apply: false });

  console.log(`${found.length} bounce messages found\n`);
  for (const bounce of found) {
    console.log(`  ${bounce.recipient}`);
    console.log(`    status: ${bounce.status ?? "-"} · ${bounce.permanent ? "PERMANENT" : "temporary"}`);
    console.log(`    ${bounce.diagnostic ?? ""}`);
  }

  console.log(`\n${cleared.length} lead addresses would be cleared:`);
  for (const lead of cleared) {
    console.log(`  ${lead.company} · ${lead.email} · ${lead.reason}`);
  }

  const rate = await bounceRate();
  console.log(`\nbounce rate: ${rate.bounced} of ${rate.sent} cold emails = ${rate.pct?.toFixed(1) ?? "-"}%`);
  console.log(rate.pct !== null && rate.pct > 5 ? "  ABOVE the 5% danger line" : "  healthy");

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
