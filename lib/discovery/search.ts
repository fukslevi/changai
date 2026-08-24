/**
 * Web search for candidate manufacturers.
 *
 * Search-first rather than a scraper per directory. Made-in-China, Global
 * Sources, 1688 and the rest each need their own parser and each breaks on its
 * own schedule; a search API plus one parser for the company's own site is far
 * less to maintain and lands on the same manufacturers — and on their real
 * email addresses, which the directories deliberately hide.
 */

/** Marketplaces, directories and noise. Never a manufacturer's own site. */
const EXCLUDED_HOSTS = [
  "alibaba.com",
  "aliexpress.com",
  "made-in-china.com",
  "globalsources.com",
  "1688.com",
  "dhgate.com",
  "tradekey.com",
  "ec21.com",
  "indiamart.com",
  "thomasnet.com",
  "europages",
  "kompass.com",
  "amazon.",
  "ebay.",
  "walmart.com",
  "etsy.com",
  "temu.com",
  "wikipedia.org",
  "youtube.com",
  "facebook.com",
  "linkedin.com",
  "instagram.com",
  "pinterest.",
  "twitter.com",
  "x.com",
  "reddit.com",
  "quora.com",
  "medium.com",
  "blogspot.",
  "wordpress.com",
  // Marketplace showroom subdomains masquerading as company sites.
  "goldsupplier.com",
  "en.china.cn",
  "diytrade.com",
  "hisupplier.com",
  "manufacturer.com",
  "exporthub.com",
  "tradeindia.com",
  "sourcify.com",
];

/**
 * A bare product term returns retail. "rear bike basket" surfaces Nantucket and
 * Retrospec; "rear bike basket OEM manufacturer China" surfaces the factories
 * that supply them. Every keyword therefore runs twice unless it already states
 * manufacturing intent.
 */
const INTENT_SUFFIX = "OEM manufacturer factory China";

function expandQuery(keyword: string): string[] {
  const statesIntent = /\b(manufacturer|factory|oem|odm|supplier|wholesale|china)\b/i.test(
    keyword,
  );
  return statesIntent ? [keyword] : [keyword, `${keyword} ${INTENT_SUFFIX}`];
}

export interface SearchHit {
  title: string;
  url: string;
  domain: string;
  snippet: string;
  query: string;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function isExcluded(domain: string): boolean {
  return EXCLUDED_HOSTS.some((bad) => domain.includes(bad));
}

async function serperSearch(query: string, limit: number): Promise<SearchHit[]> {
  const key = process.env.SERPER_API_KEY;
  if (!key) throw new Error("SERPER_API_KEY is not set - add it to .env");

  const response = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: { "X-API-KEY": key, "Content-Type": "application/json" },
    // No `gl` bias: pinning the search to the US buries Chinese manufacturer
    // sites under American retail listings for the same product term.
    body: JSON.stringify({ q: query, num: limit, hl: "en" }),
  });

  if (!response.ok) {
    throw new Error(`Serper returned ${response.status}: ${await response.text()}`);
  }

  const data = (await response.json()) as {
    organic?: { title?: string; link?: string; snippet?: string }[];
  };

  const hits: SearchHit[] = [];
  for (const item of data.organic ?? []) {
    if (!item.link) continue;
    const domain = hostOf(item.link);
    if (!domain || isExcluded(domain)) continue;
    hits.push({
      title: item.title ?? domain,
      url: item.link,
      domain,
      snippet: item.snippet ?? "",
      query,
    });
  }
  return hits;
}

/**
 * Run every keyword and collapse to one hit per company domain.
 *
 * A domain appearing under several keywords is a stronger signal than one that
 * appears once, so the first (highest-ranked) hit is kept and the extra queries
 * are recorded rather than discarded.
 */
export async function findCandidates(
  keywords: string[],
  options: { perQuery?: number } = {},
): Promise<(SearchHit & { matchedQueries: string[] })[]> {
  /*
   * Twenty, not ten. Serper bills per query rather than per result, so the
   * second ten cost nothing extra and the manufacturers rarely rank first -
   * page one of a product term is retail, and the factories start appearing
   * where the brands run out.
   */
  const perQuery = options.perQuery ?? 20;
  const byDomain = new Map<string, SearchHit & { matchedQueries: string[] }>();
  const queries = [...new Set(keywords.flatMap(expandQuery))];

  for (const keyword of queries) {
    let hits: SearchHit[] = [];
    try {
      hits = await serperSearch(keyword, perQuery);
    } catch (err) {
      // One bad query must not lose the results already collected.
      console.warn(`search failed for "${keyword}": ${err instanceof Error ? err.message : err}`);
      continue;
    }

    for (const hit of hits) {
      const existing = byDomain.get(hit.domain);
      if (existing) {
        if (!existing.matchedQueries.includes(hit.query)) existing.matchedQueries.push(hit.query);
      } else {
        byDomain.set(hit.domain, { ...hit, matchedQueries: [hit.query] });
      }
    }
  }

  return [...byDomain.values()].sort(
    (a, b) => b.matchedQueries.length - a.matchedQueries.length,
  );
}
