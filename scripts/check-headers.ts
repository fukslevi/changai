/**
 * Header sanitising, against the message that actually broke and the one that
 * would have been worse.
 *
 * The real subject was "TO: Shlomi Saadi\n" and it delivered our MIME envelope
 * as visible text. The same hole takes a crafted subject and adds a header of
 * the sender's choosing to our mail, so both are tested here - the accident
 * that happened, and the attack it was one character away from.
 */
import { sanitiseHeader } from "../lib/mail/gmail";

const cases: [string, string][] = [
  ["TO: Shlomi Saadi\n", "the real one - trailing newline"],
  ["Re: quote\r\nBcc: attacker@example.com", "Bcc injection"],
  ["Re: quote\nContent-Type: text/html", "content-type override"],
  ["Re: quote\n\nnot a header any more", "blank line ends the block"],
  ["Re:\tquote with a tab", "tab"],
  ["  Re: padded  ", "padding"],
  ["Re: 报价单 - 500 pcs", "non-ASCII, must survive"],
  ["Re: LED WORKING LIGHT - RFQ for 500 / 1,000 / 1,500 sets", "ordinary subject"],
];

let failures = 0;

for (const [input, label] of cases) {
  const output = sanitiseHeader(input);
  const stillDangerous = /[\r\n\t]/.test(output);
  if (stillDangerous) failures++;

  console.log(`[${stillDangerous ? "STILL BREAKS HEADERS" : "safe"}] ${label}`);
  console.log(`   ${JSON.stringify(input)}`);
  console.log(`   ${JSON.stringify(output)}`);
}

console.log(failures === 0 ? "\nnothing can end the header block" : `\n${failures} failing`);
process.exit(0);
