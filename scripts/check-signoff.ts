/**
 * The sign-off stripper, on the cases that matter.
 *
 * Two failure modes, opposite directions. Leaving one in produced the doubled
 * "Best regards," a supplier actually received. Stripping too eagerly would cut
 * the last real sentence of the email, which is worse and silent - so a
 * "thanks" mid-sentence has to survive.
 */
import { stripSignOff } from "../lib/inbox/reply";

const cases: [string, string][] = [
  ["Hi Lotus,\n\nCould you send prices?\n\nThank you,", "trailing thank you"],
  ["Hi Amy,\n\nUnderstood.\n\nBest regards,\nShlomi Saadi", "regards plus name"],
  ["Hello,\n\nPlease quote.\n\nThanks and regards,\nShlomi", "compound sign-off"],
  ["Hello,\n\nPlease quote at 500 / 1000 / 1500.", "no sign-off at all"],
  ["Hi,\n\nWe need three tiers.\n\nBest", "bare 'best'"],
  [
    "Hi,\n\nRegards to your team on the samples - could you price 500 pcs?",
    "'regards' mid-sentence, must survive",
  ],
  [
    "Hi,\n\nThanks for the photos, could you also send the price?",
    "'thanks' mid-sentence, must survive",
  ],
  [
    "Hi,\n\nNoted.\n\nThanks,\nShlomi\n\nBest regards,\nShlomi Saadi\nSourcing",
    "two stacked sign-offs",
  ],
];

let failures = 0;

for (const [input, label] of cases) {
  const output = stripSignOff(input);
  const lostContent = /price|tiers|quote|samples|photos/i.test(input) && !/price|tiers|quote|samples|photos/i.test(output);
  const leftSignOff = /\n\s*(best regards|regards|thanks|thank you|sincerely|best)\s*,?\s*$/i.test(output);

  const verdict = lostContent ? "LOST CONTENT" : leftSignOff ? "SIGN-OFF LEFT" : "ok";
  if (verdict !== "ok") failures++;

  console.log(`[${verdict}] ${label}`);
  console.log(`   ${JSON.stringify(output)}`);
}

console.log(failures === 0 ? "\nall cases pass" : `\n${failures} failing`);
process.exit(0);
