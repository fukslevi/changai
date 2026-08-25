/**
 * Find supplier mail that never landed on a thread we started.
 *
 * Thread-based polling is exact and it misses a whole class of reply. A sales
 * person who composes a new message instead of hitting reply, a colleague who
 * writes from their own address, a mail client that rewrites the subject - all
 * of them produce a new Gmail thread, and a new thread is invisible to a poll
 * that walks known threadIds. Four real replies were sitting unread for exactly
 * this reason, and "invisible" is indistinguishable from "never answered".
 *
 * The match is by domain rather than by address. LUMI were contacted at
 * lumi@lumi.cn and answered from lumi235@lumi.cn; insisting on the exact
 * mailbox would have kept missing them.
 *
 * It searches spam and trash too. Gmail filed a reply from market3@hjleds.com
 * as spam - a real supplier answering a real RFQ - and the default search scope
 * excludes both folders, so nothing in the system could see it. A cold enquiry
 * to a factory produces exactly the reply pattern a spam filter is suspicious
 * of, so this is not a rare accident, and a supplier who answered and was
 * ignored is worse than one who never answered at all.
 */
import { eq } from "drizzle-orm";
import { db, outreach, suppliers } from "../db";
import { gmailClient } from "../mail/gmail";

export interface StrayMessage {
  gmailMessageId: string;
  gmailThreadId: string;
  fromAddress: string;
  subject: string;
  supplierId: string;
  company: string;
}

function domainOf(address: string): string | null {
  const at = address.lastIndexOf("@");
  return at === -1 ? null : address.slice(at + 1).toLowerCase().replace(/^www\./, "");
}

function addressIn(from: string): string {
  return (from.match(/<([^>]+)>/)?.[1] ?? from).trim().toLowerCase();
}

/**
 * Inbound mail from a supplier on this project that we have not recorded.
 *
 * `knownMessageIds` is passed in rather than queried here so the caller can
 * build it once for the whole poll.
 */
export async function findStrayReplies(
  projectId: string,
  ourMailbox: string,
  knownMessageIds: Set<string>,
  options: { days?: number; max?: number } = {},
): Promise<StrayMessage[]> {
  const days = options.days ?? 21;

  // Only suppliers we actually wrote to on this project. Anything else in the
  // mailbox is not ours to read.
  const contacted = await db
    .select({
      supplierId: suppliers.id,
      email: suppliers.email,
      company: suppliers.companyName,
    })
    .from(outreach)
    .innerJoin(suppliers, eq(outreach.supplierId, suppliers.id))
    .where(eq(outreach.projectId, projectId));

  const byDomain = new Map<string, { supplierId: string; company: string }>();
  for (const row of contacted) {
    const domain = row.email ? domainOf(row.email) : null;
    if (domain && !byDomain.has(domain)) {
      byDomain.set(domain, { supplierId: row.supplierId, company: row.company ?? domain });
    }
  }
  if (byDomain.size === 0) return [];

  const gmail = gmailClient();
  const list = await gmail.users.messages.list({
    userId: "me",
    // `in:anywhere` is what reaches spam and trash; without it Gmail searches
    // the inbox only, which is the one place a filtered reply is not.
    q: `in:anywhere -from:${ourMailbox} newer_than:${days}d`,
    maxResults: options.max ?? 80,
  });

  const strays: StrayMessage[] = [];

  for (const item of list.data.messages ?? []) {
    if (!item.id || knownMessageIds.has(item.id)) continue;

    const message = await gmail.users.messages.get({
      userId: "me",
      id: item.id,
      format: "metadata",
      metadataHeaders: ["From", "Subject"],
    });

    const headers = Object.fromEntries(
      (message.data.payload?.headers ?? []).map((h) => [h.name, h.value]),
    );
    const from = addressIn(headers.From ?? "");
    const domain = domainOf(from);
    const match = domain ? byDomain.get(domain) : undefined;
    if (!match) continue;

    /*
     * Rescue it from spam so the conversation behaves normally from here.
     *
     * Leaving the label on means every later message in the thread is filtered
     * too, and the operator looking at the mailbox by hand never sees the
     * exchange. Failing to relabel must not lose the message, so the error is
     * swallowed - having read it matters more than where it sits.
     */
    const labels = message.data.labelIds ?? [];
    if (labels.includes("SPAM") || labels.includes("TRASH")) {
      try {
        await gmail.users.messages.modify({
          userId: "me",
          id: message.data.id as string,
          requestBody: { removeLabelIds: ["SPAM", "TRASH"], addLabelIds: ["INBOX"] },
        });
      } catch {
        // Read anyway.
      }
    }

    strays.push({
      gmailMessageId: message.data.id as string,
      gmailThreadId: message.data.threadId as string,
      fromAddress: headers.From ?? from,
      subject: headers.Subject ?? "",
      supplierId: match.supplierId,
      company: match.company,
    });
  }

  return strays;
}
