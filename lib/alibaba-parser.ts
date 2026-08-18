/**
 * Alibaba RFQ notification parser.
 *
 * Turns a raw `.eml` notification from alisourcepro@service.alibaba.com into a
 * deduped supplier roster for one RFQ.
 *
 * Three things this recovers that are NOT visible when you read the email:
 *   1. rfqId  — a stable project key. Project attribution with zero guessing.
 *   2. quoId  — a stable quote key. The same quotation reappears across several
 *               notification emails; without this you double-count suppliers.
 *   3. MOQ    — Alibaba masks the quantity as "***" in the rendered text, but
 *               its template engine leaves the real value in an HTML comment
 *               immediately before it. The price is NOT recoverable: that
 *               comment holds an unrendered `${priceMax}` variable, not a number.
 *
 * Built against two notifications from Jan 2021 (rfqId 1635395319, "Baby Nest").
 * Alibaba has almost certainly revised the template since — treat
 * TEMPLATE_FINGERPRINT as the guard and re-verify against a current sample.
 *
 *   npm i cheerio
 */

import * as cheerio from "cheerio";

/* ─────────────────────────────────────────────────────────────
 * Types
 * ───────────────────────────────────────────────────────────── */

export interface QuotationLead {
  /** Stable per-quotation key. Dedupe on this. */
  quoId: string;
  /** Absent on the featured quotation — Alibaba only names the "More Suppliers" entries. */
  supplierName: string | null;
  /** Truncated by Alibaba, e.g. "Multifunctional breathable and..." */
  productTitle: string | null;
  incoterm: "FOB" | "EXW" | "CIF" | "DDP" | "FCA" | null;
  /** Real MOQ, recovered from the HTML comment. Null if the template changed. */
  moq: number | null;
  /** Alibaba masks this; it is never recoverable from the email. */
  unitPrice: null;
  offersSample: boolean;
  /** Full-size product photo. The `_220x220` CDN suffix is stripped. */
  imageUrl: string | null;
  /** Direct deep link to this quotation — the operator's click-list. */
  deepLink: string;
}

export interface AlibabaNotification {
  rfqId: string;
  rfqTitle: string | null;
  rfqDate: string | null;
  recipient: string | null;
  sentAt: string | null;
  /** DKIM + SPF + DMARC all passed. Never trust a notification that fails this. */
  senderVerified: boolean;
  quotations: QuotationLead[];
}

/** Bump when Alibaba revises the template so stale parses fail loudly. */
export const TEMPLATE_FINGERPRINT = "2021-01-rfq-notification";

const ALIBABA_SENDER = "alisourcepro@service.alibaba.com";

/* ─────────────────────────────────────────────────────────────
 * MIME
 * ───────────────────────────────────────────────────────────── */

/** RFC 2045 quoted-printable. Decodes to bytes first so UTF-8 survives. */
export function decodeQuotedPrintable(input: string): string {
  const unfolded = input.replace(/=\r?\n/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < unfolded.length; i++) {
    const hex = unfolded.slice(i + 1, i + 3);
    if (unfolded[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(hex)) {
      bytes.push(parseInt(hex, 16));
      i += 2;
    } else {
      bytes.push(unfolded.charCodeAt(i) & 0xff);
    }
  }
  return Buffer.from(bytes).toString("utf8");
}

function splitHeadersAndBody(raw: string): { headers: Map<string, string>; body: string } {
  const idx = raw.search(/\r?\n\r?\n/);
  const headerText = idx === -1 ? raw : raw.slice(0, idx);
  const body = idx === -1 ? "" : raw.slice(idx).replace(/^\r?\n\r?\n/, "");

  // Unfold continuation lines before splitting on ":".
  const headers = new Map<string, string>();
  for (const line of headerText.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    // Keep the first occurrence — later Received: hops are noise here.
    if (!headers.has(key)) headers.set(key, value);
  }
  return { headers, body };
}

/** Pull the text/html part out of a multipart body (or return it as-is). */
function extractHtmlPart(body: string, contentType: string): string {
  const boundaryMatch = /boundary="?([^";\s]+)"?/i.exec(contentType);
  if (!boundaryMatch) return body;

  for (const part of body.split(`--${boundaryMatch[1]}`)) {
    if (!/content-type:\s*text\/html/i.test(part)) continue;
    const { headers, body: partBody } = splitHeadersAndBody(part.replace(/^\r?\n/, ""));
    return /quoted-printable/i.test(headers.get("content-transfer-encoding") ?? "")
      ? decodeQuotedPrintable(partBody)
      : partBody;
  }
  return body;
}

/* ─────────────────────────────────────────────────────────────
 * Field extraction
 * ───────────────────────────────────────────────────────────── */

const QUO_ID = /quoId=(\d+)/;
const RFQ_ID = /rfqId=(\d+)/;
const INCOTERMS = ["FOB", "EXW", "CIF", "DDP", "FCA"] as const;

/** `<!-- 500 -->` sitting immediately before the masked `*** Pieces or more`. */
function extractMoqFromComment(html: string): number | null {
  const match = /<!--\s*(\d+)\s*-->/.exec(html);
  return match ? Number(match[1]) : null;
}

function extractIncoterm(text: string): QuotationLead["incoterm"] {
  return INCOTERMS.find((t) => new RegExp(`\\b${t}\\b`).test(text)) ?? null;
}

/** Strip the CDN resize directive to get the original upload. */
function fullSizeImage(src: string): string {
  return src.replace(/\.jpg_\d+x\d+\.jpg$/i, ".jpg").replace(/_\d+x\d+\.(jpg|png|webp)$/i, ".$1");
}

/* ─────────────────────────────────────────────────────────────
 * Parser
 * ───────────────────────────────────────────────────────────── */

export function parseAlibabaNotification(rawEml: string): AlibabaNotification {
  const { headers, body } = splitHeadersAndBody(rawEml);

  const from = headers.get("from") ?? "";
  const auth = headers.get("authentication-results") ?? "";
  const senderVerified =
    from.includes(ALIBABA_SENDER) &&
    /dkim=pass/.test(auth) &&
    /spf=pass/.test(auth) &&
    /dmarc=pass/.test(auth);

  const html = extractHtmlPart(body, headers.get("content-type") ?? "");
  const $ = cheerio.load(html);

  const rfqId = RFQ_ID.exec(html)?.[1];
  if (!rfqId) {
    throw new Error(
      `No rfqId found. Alibaba likely changed the template (expected ${TEMPLATE_FINGERPRINT}).`,
    );
  }

  // Product photos are in sibling tables, not in the field blocks — collect
  // them in one pass and match back by quoId.
  const imagesByQuoId = new Map<string, string>();
  $("a").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const src = $(el).find("img").attr("src");
    const id = QUO_ID.exec(href)?.[1];
    if (id && src && /alicdn\.com\/kf\//.test(src) && !imagesByQuoId.has(id)) {
      imagesByQuoId.set(id, fullSizeImage(src));
    }
  });

  // Each quotation's fields live in the one table whose text contains "Quantity:".
  const byQuoId = new Map<string, QuotationLead>();

  $("table").each((_, table) => {
    const $t = $(table);
    if ($t.find("table").length > 0) return; // innermost only
    const text = $t.text();
    if (!text.includes("Quantity:")) return;

    const blockHtml = $t.html() ?? "";
    // The featured quotation carries quoId inside the block; the "More Suppliers"
    // entries keep it in a sibling right-aligned button table, so widen the search.
    const quoId =
      QUO_ID.exec(blockHtml)?.[1] ?? QUO_ID.exec($t.parent().html() ?? "")?.[1];
    if (!quoId || byQuoId.has(quoId)) return;

    const rows = $t.find("tr").toArray().map((tr) => ({
      text: $(tr).text().replace(/\s+/g, " ").trim(),
      html: $(tr).html() ?? "",
    }));

    const fromRow = rows.find((r) => r.text.startsWith("From:"));
    const qtyRow = rows.find((r) => r.text.includes("Quantity:"));
    const priceRow = rows.find((r) => r.text.includes("Unit Price:"));

    const supplierName =
      fromRow?.text
        .replace(/^From:\s*/, "")
        .replace(/Offers Sample\s*$/, "")
        .trim() || null;

    byQuoId.set(quoId, {
      quoId,
      supplierName,
      productTitle: rows[0]?.text || null,
      incoterm: extractIncoterm(priceRow?.text ?? ""),
      moq: qtyRow ? extractMoqFromComment(qtyRow.html) : null,
      unitPrice: null, // masked by Alibaba — only available behind login
      offersSample: /Offers Sample/.test(text),
      imageUrl: imagesByQuoId.get(quoId) ?? null,
      deepLink: `https://mysourcing.alibaba.com/rfq/request/rfq_manage_detail.htm?quoId=${quoId}&process=quo&rfqId=${rfqId}`,
    });
  });

  const subject = headers.get("subject") ?? "";
  const rfqTitle =
    /A new quotation received for(?: for)? (.+)$/i.exec(subject)?.[1]?.trim() ?? null;

  return {
    rfqId,
    rfqTitle,
    rfqDate: /dated on (\d{4}-\d{2}-\d{2})/.exec($("body").text())?.[1] ?? null,
    recipient: /<([^>]+)>/.exec(headers.get("to") ?? "")?.[1] ?? null,
    sentAt: headers.get("date") ?? null,
    senderVerified,
    quotations: [...byQuoId.values()],
  };
}

/**
 * Merge every notification for one RFQ into a single roster.
 * Later sightings win — Alibaba fills in the supplier name on the second pass.
 */
export function mergeNotifications(notifications: AlibabaNotification[]): {
  rfqId: string;
  quotations: QuotationLead[];
} {
  const first = notifications[0];
  if (!first) throw new Error("No notifications to merge");

  const ids = new Set(notifications.map((n) => n.rfqId));
  if (ids.size > 1) throw new Error(`Mixed rfqIds: ${[...ids].join(", ")}`);

  const merged = new Map<string, QuotationLead>();
  for (const n of notifications) {
    for (const q of n.quotations) {
      const prev = merged.get(q.quoId);
      merged.set(q.quoId, {
        ...prev,
        ...q,
        supplierName: q.supplierName ?? prev?.supplierName ?? null,
        imageUrl: q.imageUrl ?? prev?.imageUrl ?? null,
        moq: q.moq ?? prev?.moq ?? null,
      });
    }
  }
  return { rfqId: first.rfqId, quotations: [...merged.values()] };
}
