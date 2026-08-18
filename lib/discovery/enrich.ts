/**
 * Turn a company domain into a contact address.
 *
 * This is the actual bottleneck in supplier discovery. Finding manufacturers is
 * easy - directories are full of them. Finding a working mailbox is the work,
 * and it is the same problem Alibaba creates by hiding contact details, just
 * spread across more sites. Serious Chinese manufacturers do publish an address
 * on their own site, which is why discovery routes through the company site
 * rather than through a marketplace listing.
 *
 * The contact page is found by following links from the homepage rather than by
 * guessing paths. Guessing missed chinabikerack.com/contact-us.html - the page
 * existed, the extension did not match, and the lead was stored as "no email"
 * while a human found the address in seconds.
 */

/** Tried only when the homepage yields no usable links. */
const FALLBACK_PATHS = [
  "/contact",
  "/contact-us",
  "/contact-us.html",
  "/contact.html",
  "/contactus",
  "/contact_us.html",
  "/contact.php",
  "/en/contact",
  "/about",
  "/about-us",
];

const EMAIL_PATTERN = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

/**
 * Sites that publish an address as "sales(at)acme.com" to dodge scrapers. The
 * address is meant to be readable by a person, so read it.
 */
const OBFUSCATED = /([a-z0-9._%+-]+)\s*(?:\(at\)|\[at\]|\s+at\s+)\s*([a-z0-9.-]+)\s*(?:\(dot\)|\[dot\]|\s+dot\s+)\s*([a-z]{2,})/gi;

/** Addresses that belong to the site's tooling rather than to a human. */
const JUNK_PATTERNS = [
  /@(example|test|domain|yourdomain|email|sentry|wixpress|godaddy|squarespace)\./i,
  /@(sentry|cloudflare|jquery|bootstrapcdn|googleapis|gstatic|w3\.org)/i,
  /\.(png|jpg|jpeg|gif|webp|svg|css|js)$/i,
  /^(no-?reply|donotreply|postmaster|abuse|webmaster|verify|unsubscribe)@/i,
  /^privacy@|^legal@|^dmca@|^press@|^careers?@|^jobs?@/i,
];

/**
 * "abc@abc.com" is filler left in a template. "lumi@lumi.cn" is a real mailbox
 * at a company whose brand is its domain - which is normal, not suspicious.
 * Only a known dummy token counts, so the rule stops eating live addresses.
 */
const DUMMY_LOCAL = /^(abc|aaa|bbb|xxx|xyz|test|demo|sample|mail|email|name|user|your|company)$/;

function isPlaceholder(email: string): boolean {
  const [local, host] = email.split("@");
  const root = host?.split(".")[0];
  if (!local || !root) return false;
  return DUMMY_LOCAL.test(local) && (local === root || DUMMY_LOCAL.test(root));
}

/** Prefer a person or a sales/export desk over a generic catch-all. */
function rankEmail(email: string): number {
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  if (/^(sales|export|trade|business|bd)/.test(local)) return 0;
  if (/^(info|contact|inquiry|enquiry|service)/.test(local)) return 2;
  if (/^(admin|support|hr|job|finance|account)/.test(local)) return 3;
  return 1; // a personal name
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

/**
 * Cheap content hash for spotting a soft 404 - the same page served for every
 * unknown path. It must cover the whole document: lumi.cn's contact page and
 * its homepage share the first several hundred characters of boilerplate, so a
 * prefix comparison threw the real contact page away.
 */
function fingerprint(html: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < html.length; i++) {
    h ^= html.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${html.length}:${(h >>> 0).toString(36)}`;
}

function decode(html: string): string {
  return html
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&[a-z#0-9]+;/gi, (e) => ENTITIES[e.toLowerCase()] ?? " ");
}

async function fetchText(url: string, timeoutMs: number): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        // Some Chinese hosts return a stub page to unrecognised agents.
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
        "Accept-Language": "en,zh;q=0.8",
      },
    });
    if (!response.ok) return null;
    const type = response.headers.get("content-type") ?? "";
    if (!type.includes("text/html") && !type.includes("text/plain")) return null;
    return (await response.text()).slice(0, 400_000);
  } catch {
    return null; // dead host, TLS failure, timeout - all just "no contact found"
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Search results are stored with the `www.` stripped, but plenty of Chinese
 * hosts answer only on `www` - the apex does not resolve at all. Trying just
 * one form reported "site unreachable" for lumi.cn and chinabikerack.com, both
 * of which load fine in a browser. Try the forms in order and keep the first
 * that responds.
 */
async function resolveOrigin(
  domain: string,
  timeoutMs: number,
  seedUrl?: string,
): Promise<{ origin: string; html: string } | null> {
  const bare = domain.replace(/^www\./, "");
  // Prefixing www only makes sense on an apex. "global.ymbicycleparts.com"
  // already names a host; www.global.… does not exist.
  const hosts = bare.split(".").length > 2 ? [bare] : [`www.${bare}`, bare];

  const candidates = [
    seedUrl && safeOrigin(seedUrl),
    ...hosts.map((h) => `https://${h}`),
    // Plain http is the last resort, and it is a real one: several Chinese
    // hosts serve an incomplete certificate chain that a browser repairs and
    // Node rejects outright. TLS verification stays on - an unverified https
    // connection could hand us a substituted address, which is worse than
    // knowing the page was fetched in the clear.
    ...hosts.map((h) => `http://${h}`),
  ].filter((v): v is string => Boolean(v));

  for (const origin of [...new Set(candidates)]) {
    const html = await fetchText(origin, timeoutMs);
    if (html !== null) return { origin, html };
  }
  return null;
}

function safeOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

const CONTACT_HINT = /contact|about|inquiry|enquiry|reach|connect|联系|关于/i;

/** Absolute URLs on this site whose link or text points at a contact page. */
export async function findContactUrls(
  origin: string,
  html?: string,
  limit = 4,
): Promise<string[]> {
  const page = html ?? (await fetchText(origin, 12_000));
  if (!page) return [];
  const bare = new URL(origin).hostname.replace(/^www\./, "");

  const urls = new Map<string, number>();
  const anchor = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi;

  for (const match of page.matchAll(anchor)) {
    const href = match[1] ?? "";
    const text = decode((match[2] ?? "").replace(/<[^>]+>/g, " "));
    if (!CONTACT_HINT.test(href) && !CONTACT_HINT.test(text)) continue;
    if (/^(mailto|tel|javascript):/i.test(href)) continue;

    let absolute: URL;
    try {
      absolute = new URL(decode(href), origin);
    } catch {
      continue;
    }
    // Staying on the domain keeps us off the supplier's Facebook page.
    if (!absolute.hostname.endsWith(bare)) continue;
    absolute.hash = "";

    // A link whose own text says "contact" beats one that merely has it in the
    // path, and "contact" beats "about" - both feed the visit order.
    const score =
      (/contact|联系/i.test(text) ? 0 : 2) + (/contact|联系/i.test(absolute.pathname) ? 0 : 1);
    const key = absolute.toString();
    urls.set(key, Math.min(urls.get(key) ?? 9, score));
  }

  return [...urls.entries()]
    .sort((a, b) => a[1] - b[1])
    .slice(0, limit)
    .map(([url]) => url);
}

export interface EnrichedContact {
  emails: string[];
  /** Best guess, already ranked. */
  primaryEmail: string | null;
  pagesFetched: number;
  companyText: string;
  /** Where each address was found - shown to the operator when they disagree. */
  visited: string[];
}

function harvest(html: string, into: Set<string>): void {
  const visible = decode(
    html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " "),
  );

  // A mailto: link is the company stating its own address; take those first.
  const candidates = [
    ...[...html.matchAll(/mailto:([^"'?>\s]+)/gi)].map((m) => decode(m[1] ?? "")),
    ...(visible.match(EMAIL_PATTERN) ?? []),
    ...[...visible.matchAll(OBFUSCATED)].map((m) => `${m[1]}@${m[2]}.${m[3]}`),
  ];

  for (const raw of candidates) {
    const email = raw.toLowerCase().trim();
    if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(email)) continue;
    if (JUNK_PATTERNS.some((p) => p.test(email))) continue;
    if (isPlaceholder(email)) continue;
    into.add(email);
  }
}

export async function enrichDomain(
  domain: string,
  options: { timeoutMs?: number; maxPages?: number; seedUrl?: string } = {},
): Promise<EnrichedContact> {
  const timeoutMs = options.timeoutMs ?? 12_000;
  const maxPages = options.maxPages ?? 5;

  const found = new Set<string>();
  const text: string[] = [];
  const visited: string[] = [];
  const seenBodies = new Set<string>();

  const root = await resolveOrigin(domain, timeoutMs, options.seedUrl);
  if (!root) {
    return { emails: [], primaryEmail: null, pagesFetched: 0, companyText: "", visited: [] };
  }

  const { origin, html: home } = root;
  visited.push(origin);
  seenBodies.add(fingerprint(home));
  harvest(home, found);
  text.push(
    decode(home.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " "))
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 3000),
  );

  // Follow real links first; fall back to guessed paths only if there were none.
  const linked = await findContactUrls(origin, home);
  const targets = linked.length > 0 ? linked : FALLBACK_PATHS.map((p) => `${origin}${p}`);

  for (const url of targets) {
    if (visited.length >= maxPages) break;
    // A contact page that already yielded an address ends the crawl.
    if (found.size > 0 && visited.length > 1) break;

    const html = await fetchText(url, timeoutMs);
    if (html === null) continue;

    // Many sites serve the homepage for every unknown path. Counting those as
    // real pages burns the budget and reports "searched" work that never was.
    const mark = fingerprint(html);
    if (seenBodies.has(mark)) continue;
    seenBodies.add(mark);

    visited.push(url);
    harvest(html, found);

    if (text.length < 2) {
      text.push(
        decode(html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " "))
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 3000),
      );
    }
  }

  const emails = [...found].sort((a, b) => rankEmail(a) - rankEmail(b));

  return {
    emails,
    primaryEmail: emails[0] ?? null,
    pagesFetched: visited.length,
    companyText: text.join(" ").slice(0, 4000),
    visited,
  };
}
