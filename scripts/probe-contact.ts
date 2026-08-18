/**
 * Probe a domain the way enrichment does, and report every path it tried.
 *
 *   npx tsx --env-file=.env scripts/probe-contact.ts lumilegend.com chinabikerack.com
 *
 * Written because two leads showed "no email" while the operator found an
 * address on the contact page in seconds. A crawler that silently returns null
 * is indistinguishable from a company with no mailbox - this makes the
 * difference visible.
 */
import { enrichDomain, findContactUrls } from "../lib/discovery/enrich";

const PATHS = [
  "",
  "/contact",
  "/contact-us",
  "/contact-us.html",
  "/contact.html",
  "/contactus",
  "/about",
  "/en/contact",
];

async function head(url: string) {
  try {
    const r = await fetch(url, {
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
      },
    });
    const body = await r.text();
    const emails = [...new Set(body.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) ?? [])];
    return `${r.status} ${String(body.length).padStart(7)}b  ${emails.slice(0, 4).join(", ") || "-"}`;
  } catch (err) {
    return `ERR ${err instanceof Error ? err.message.slice(0, 60) : ""}`;
  }
}

async function main() {
  const domains = process.argv.slice(2);
  if (domains.length === 0) throw new Error("Pass at least one domain");

  for (const domain of domains) {
    console.log(`\n=== ${domain} ===`);
    for (const path of PATHS) {
      console.log(`  ${(path || "/").padEnd(20)} ${await head(`https://${domain}${path}`)}`);
    }

    const discovered = await findContactUrls(`https://www.${domain.replace(/^www\./, "")}`);
    console.log(`  links found on homepage: ${discovered.join(", ") || "(none)"}`);

    const result = await enrichDomain(domain);
    console.log(
      `  -> enrich: ${result.pagesFetched} pages, emails: ${result.emails.join(", ") || "(none)"}`,
    );
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
