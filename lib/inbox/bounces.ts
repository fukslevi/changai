/**
 * Addresses that do not exist.
 *
 * Every address in this system was scraped off a contact page, and some share
 * of them is always wrong - a mailbox that was closed, a role account that was
 * decommissioned, a typo in the page's own HTML. Nothing here could see that.
 * A bounce comes from a mail daemon, matches no supplier domain, and the sweep
 * dropped it on the floor.
 *
 * The cost of not knowing is not the individual lost enquiry. It is that a
 * mailbox which keeps writing to dead addresses loses its sending reputation,
 * and it loses it silently: the mail keeps being accepted, it just stops
 * arriving. That happens long before any published quota is reached, and by the
 * time it is visible the damage is done.
 *
 * A probe of this mailbox found zero bounces across 113 outbound emails, which
 * is a genuinely good result and not a reason to skip this. Zero today is a
 * measurement, not a property - it becomes one only if something keeps
 * measuring.
 */
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db, messages, supplierLeads, suppliers } from "../db";
import { gmailClient } from "../mail/gmail";

export interface Bounce {
  gmailMessageId: string;
  /** The address that failed, from the delivery report. */
  recipient: string;
  /** 5.x.x is permanent, 4.x.x is a retry. Null when unstated. */
  status: string | null;
  permanent: boolean;
  diagnostic: string | null;
}

export interface BounceSweep {
  found: Bounce[];
  /**
   * Distinct addresses cleared, not bounce events.
   *
   * A dead address bounces on every send, so three bad mailboxes produced
   * twelve reports - and a list of twelve looks like twelve problems rather
   * than three suppliers we kept writing to.
   */
  cleared: { company: string; email: string; reason: string }[];
}

/**
 * Gmail reports a failure three ways and only one of them is machine readable.
 *
 * The DSN part is the reliable one; the subject and sender are the fallback for
 * servers that send a human-readable note instead. Both are cheap, so both are
 * used - a bounce missed because the remote server was old-fashioned is still a
 * dead address we keep writing to.
 */
const BOUNCE_FROM = /mailer-daemon|postmaster|no-?reply@.*(mail|smtp|delivery)/i;
const BOUNCE_SUBJECT =
  /undeliverable|undelivered|delivery (status|has failed|failure|incomplete|notification)|returned mail|failure notice|address not found|mail delivery (failed|subsystem)/i;

/** 5.x.x means it will never be deliverable. 4.x.x is worth another attempt. */
function isPermanent(status: string | null, body: string): boolean {
  if (status) return status.startsWith("5");
  return /\b5\.[0-9]\.[0-9]\b|\b55[0-4]\b|user unknown|no such user|does not exist|recipient rejected/i.test(
    body,
  );
}

function decode(data: string | null | undefined): string {
  if (!data) return "";
  return Buffer.from(data, "base64").toString("utf8");
}

/** Walk every part, because DSNs nest differently between servers. */
function collectText(part: unknown): string {
  const node = part as {
    mimeType?: string;
    body?: { data?: string | null };
    parts?: unknown[];
  };
  if (!node) return "";

  let text = decode(node.body?.data);
  for (const child of node.parts ?? []) text += `\n${collectText(child)}`;
  return text;
}

/**
 * Find bounces in the mailbox and mark the addresses dead.
 *
 * Only clears an address on a permanent failure. A temporary one - a full
 * mailbox, a server having a bad afternoon - is exactly the case where deleting
 * the address would lose a supplier who is perfectly reachable tomorrow.
 */
export async function sweepBounces(
  options: { days?: number; max?: number; apply?: boolean } = {},
): Promise<BounceSweep> {
  const days = options.days ?? 30;
  const apply = options.apply ?? true;
  const gmail = gmailClient();

  const list = await gmail.users.messages.list({
    userId: "me",
    // Bounces are frequently filed as spam by the receiving side too.
    q: `in:anywhere newer_than:${days}d (from:mailer-daemon OR from:postmaster OR subject:(undeliverable OR undelivered OR "delivery status" OR "address not found" OR "failure notice"))`,
    maxResults: options.max ?? 50,
  });

  const found: Bounce[] = [];

  for (const stub of list.data.messages ?? []) {
    if (!stub.id) continue;

    const message = await gmail.users.messages.get({
      userId: "me",
      id: stub.id,
      format: "full",
    });

    const headers = Object.fromEntries(
      (message.data.payload?.headers ?? []).map((h) => [h.name?.toLowerCase(), h.value ?? ""]),
    );

    const from = headers.from ?? "";
    const subject = headers.subject ?? "";
    if (!BOUNCE_FROM.test(from) && !BOUNCE_SUBJECT.test(subject)) continue;

    const body = collectText(message.data.payload);

    const recipient =
      body.match(/Final-Recipient:\s*rfc822;\s*([^\s<>]+@[^\s<>]+)/i)?.[1] ??
      body.match(/Original-Recipient:\s*rfc822;\s*([^\s<>]+@[^\s<>]+)/i)?.[1] ??
      body.match(/(?:to|for)\s+<?([^\s<>]+@[^\s<>]+)>?\s+(?:failed|was not|could not)/i)?.[1] ??
      message.data.snippet?.match(/([^\s<>]+@[^\s<>]+\.[a-z]{2,})/i)?.[1] ??
      null;

    if (!recipient) continue;

    const status = body.match(/Status:\s*([45]\.[0-9]+\.[0-9]+)/i)?.[1] ?? null;
    const diagnostic =
      body.match(/Diagnostic-Code:\s*(.+)/i)?.[1]?.trim().slice(0, 200) ??
      message.data.snippet?.slice(0, 200) ??
      null;

    found.push({
      gmailMessageId: stub.id,
      recipient: recipient.toLowerCase(),
      status,
      permanent: isPermanent(status, body),
      diagnostic,
    });
  }

  const cleared: BounceSweep["cleared"] = [];
  const seen = new Set<string>();

  for (const bounce of found) {
    if (!bounce.permanent) continue;
    if (seen.has(bounce.recipient)) continue;
    seen.add(bounce.recipient);

    const leads = await db
      .select({
        id: supplierLeads.id,
        company: supplierLeads.companyName,
        email: supplierLeads.email,
      })
      .from(supplierLeads)
      .where(and(isNotNull(supplierLeads.email), eq(supplierLeads.email, bounce.recipient)));

    for (const lead of leads) {
      if (apply) {
        /*
         * The address goes, the lead stays. The company is real - we found it
         * on its own website - and a different address there may well work.
         * Deleting the row would also let discovery rediscover it tomorrow and
         * write to the same dead mailbox again.
         */
        await db
          .update(supplierLeads)
          .set({ email: null, status: "pending" })
          .where(eq(supplierLeads.id, lead.id));
      }
      cleared.push({
        company: lead.company,
        email: lead.email as string,
        reason: bounce.status ?? "permanent failure",
      });
    }

    if (apply) {
      await db
        .update(suppliers)
        .set({ email: null })
        .where(eq(suppliers.email, bounce.recipient));
    }
  }

  return { found, cleared };
}

/**
 * Hard bounces as a share of what we sent, for the settings page.
 *
 * A different denominator from the pacing allowance, deliberately. That one
 * counts mail to people who never wrote to us, because that is what risks the
 * mailbox. This one counts every message that could have bounced, because that
 * is what a bounce rate means - a price ask to an address that has already
 * answered is not a deliverability test, but it is still a delivery.
 */
export interface BounceHealth {
  /** Messages we sent that came back. This is the deliverability number. */
  bounced: number;
  sent: number;
  pct: number | null;
  /** Distinct mailboxes that do not exist. This is the address-quality number. */
  deadAddresses: number;
}

/**
 * Two numbers, because they answer different questions and only one of them is
 * about the mailbox.
 *
 * Bounced messages over messages sent is what a mail provider watches: every
 * bounce is a delivery that failed, and a dead address bounces again on every
 * send, so writing to three bad mailboxes four times each counts as twelve.
 * That is the honest deliverability figure and it is meant to.
 *
 * Distinct dead addresses over addresses written to is what says how good the
 * scraping is. Reporting only the first makes the extraction look four times
 * worse than it is; reporting only the second hides the repetition, which is
 * the part that actually costs reputation.
 */
export async function bounceRate(): Promise<BounceHealth> {
  const outbound = await db
    .select({ id: messages.id })
    .from(messages)
    .where(
      eq(messages.direction, "outbound"),
    );

  const { found } = await sweepBounces({ apply: false });
  const permanent = found.filter((b) => b.permanent);
  const bounced = permanent.length;

  return {
    sent: outbound.length,
    bounced,
    pct: outbound.length > 0 ? (bounced / outbound.length) * 100 : null,
    deadAddresses: new Set(permanent.map((b) => b.recipient)).size,
  };
}

/**
 * An auto-reply that names somebody else is a working address we were given.
 *
 * Forest Drapery answered twice with autoresponders - maternity leave, then
 * out of office - and the first one said "please contact sales@forestdh.com".
 * Nothing read it. The supplier told us exactly where to write and we filed it
 * as an irrelevant message and moved on.
 *
 * Only addresses on the same domain are taken. An auto-reply can name anyone -
 * a personal account, a customer, a competitor - and writing to a stranger
 * because a robot mentioned them is worse than missing the redirect.
 *
 * That rule immediately earned itself on the case this was written for. Forest
 * Group's out-of-office named sales@forestdh.com, a different company that we
 * already hold as a separate supplier at exactly that address, so the redirect
 * was both wrong to follow and unnecessary. It finds nothing today; it stays as
 * a check rather than wired into the cycle, because a colleague's address at
 * the same company is a real pattern and this is where it will be caught.
 */
export interface Redirect {
  supplierId: string;
  company: string;
  from: string;
  to: string;
}

/**
 * Only auto-replies, because ordinary replies are already handled.
 *
 * A reply is answered at the address it came from, so a salesperson signing
 * with a different mailbox changes nothing - the first version of this flagged
 * five of those and none of them were a problem. What is worth catching is the
 * message nobody is reading: an out-of-office that names a colleague, where
 * answering the sender reaches an empty desk.
 */
const AUTO_REPLY =
  /out of (the )?office|auto[- ]?reply|automatic reply|on (annual |maternity |sick )?leave|away from my desk|currently unavailable|will return on/i;

const REDIRECT_PHRASE =
  /(contact|email|write to|reach|forward|send.*to|in my absence|urgent)/i;

export async function findRedirects(projectId: string): Promise<Redirect[]> {
  const rows = await db
    .select({
      supplierId: messages.supplierId,
      company: suppliers.companyName,
      current: suppliers.email,
      from: messages.fromAddress,
      body: messages.bodyText,
      classification: messages.classification,
    })
    .from(messages)
    .leftJoin(suppliers, eq(messages.supplierId, suppliers.id))
    .where(and(eq(messages.projectId, projectId), eq(messages.direction, "inbound")));

  const out = new Map<string, Redirect>();

  for (const row of rows) {
    if (!row.supplierId || !row.current) continue;

    const body = row.body ?? "";
    if (!AUTO_REPLY.test(body)) continue;
    if (!REDIRECT_PHRASE.test(body)) continue;

    const domain = row.current.split("@")[1]?.toLowerCase();
    if (!domain) continue;

    for (const match of body.matchAll(/([\w.+-]+@[\w.-]+\.[a-z]{2,})/gi)) {
      const candidate = match[1]!.toLowerCase();
      if (candidate === row.current.toLowerCase()) continue;
      if (candidate.split("@")[1] !== domain) continue;

      out.set(row.supplierId, {
        supplierId: row.supplierId,
        company: row.company ?? domain,
        from: row.current,
        to: candidate,
      });
      break;
    }
  }

  return [...out.values()];
}
