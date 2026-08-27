/**
 * Drizzle tables. These mirror lib/schema.ts, which stays the single source of
 * truth for shape and documentation.
 *
 * Enum-like columns are `text().$type<...>()` rather than Postgres enums on
 * purpose: every enum in this domain has changed at least twice while reading
 * real supplier documents, and altering a pg enum is a migration each time.
 * Text plus a compile-time type gives the same safety in application code
 * without the migration cost.
 */

import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/** pg-core has no bytea helper; this is the standard custom-type shim. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});
import type {
  ComplianceCheck,
  Incoterm,
  ItemKind,
  LeadTime,
  PaymentTerms,
  PricePoint,
  PricingAxis,
  RequirementCategory,
} from "../schema";

/* ── Projects ─────────────────────────────────────────────────────────────── */

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  /** Free-text keywords the operator supplies; seeds supplier discovery. */
  keywords: jsonb("keywords").$type<string[]>().notNull().default([]),
  version: text("version"),
  period: text("period"),
  status: text("status")
    .$type<"draft" | "sourcing" | "negotiating" | "sampling" | "closed">()
    .notNull()
    .default("draft"),
  /** Read from the RFQ's own pricing table — never defaulted. See schema.ts. */
  quantityTiers: jsonb("quantity_tiers").$type<number[]>().notNull().default([]),
  currency: text("currency").notNull().default("USD"),
  sourceRfqFile: text("source_rfq_file"),
  /**
   * The first-contact email. Generated from the parsed RFQ, then edited by the
   * operator. Stored so that what was reviewed is exactly what gets sent —
   * regenerating would silently change the text under an approved shortlist.
   */
  outreachSubject: text("outreach_subject"),
  outreachBody: text("outreach_body"),

  /*
   * Commercial model.
   *
   * These are the numbers that turn a quote into a decision. Without them a
   * price is just a number: a $7.70 FOB on a bulky product can land at $15 and
   * fail the return rule while looking like a win. They live on the project
   * rather than in a spreadsheet because the walk-away price has to be
   * computable at the moment a supplier answers, not afterwards.
   */
  /** Required return: 1.0 = the unit must earn back its own landed cost. */
  targetRoi: numeric("target_roi", { precision: 4, scale: 2 }).$type<string>(),
  /** Advertising as a share of revenue, and whether the ROI rule sits after it. */
  ppcPct: numeric("ppc_pct", { precision: 5, scale: 2 }).$type<string>(),
  roiAfterPpc: boolean("roi_after_ppc").notNull().default(true),
  /** Marketplace commission. 15% on most categories. */
  referralPct: numeric("referral_pct", { precision: 5, scale: 2 }).$type<string>(),
  /** Customs. The 3% vs 28% gap decides whether the product exists at all. */
  hsCode: text("hs_code"),
  dutyRatePct: numeric("duty_rate_pct", { precision: 5, scale: 2 }).$type<string>(),
  /** Sea freight door to warehouse. The dominant cost on bulky, cheap goods. */
  freightUsdPerCbm: numeric("freight_usd_per_cbm", { precision: 8, scale: 2 }).$type<string>(),
  /** Everything between the port and the fulfilment centre, per unit. */
  inboundUsdPerUnit: numeric("inbound_usd_per_unit", { precision: 8, scale: 2 }).$type<string>(),

  /*
   * How far the agent may go on its own.
   *
   *   1  ask for facts, answer from the documents, escalate anything else
   *   3  negotiate price and specification inside the mandate below
   *
   * There is no tier at which the agent places an order, pays a deposit or
   * commits to tooling spend. Those are the point where money leaves the
   * company, and no amount of autonomy over a conversation implies authority
   * over a bank transfer.
   */
  autonomyTier: integer("autonomy_tier").notNull().default(1),
  /** Samples the agent may commit to without asking. 0 means never. */
  sampleBudgetUsd: numeric("sample_budget_usd", { precision: 10, scale: 2 }).$type<string>(),
  /** Tooling the agent may accept without asking. 0 means never. */
  maxToolingUsd: numeric("max_tooling_usd", { precision: 10, scale: 2 }).$type<string>(),
  /**
   * Whether a supplier may talk us out of a specification. Off by default: a
   * substitution changes what you are selling, and the supplier proposing it is
   * the party who benefits from it.
   */
  allowSpecSubstitution: boolean("allow_spec_substitution").notNull().default(false),
  /**
   * A circuit breaker, not a conversation policy.
   *
   * It exists so a thread that is going nowhere cannot bill forever, not to cut
   * off a negotiation that is working - so it sits well above the length of any
   * real exchange. Four was too low: it would have handed over a productive
   * conversation mid-sentence.
   */
  maxNegotiationRounds: integer("max_negotiation_rounds").notNull().default(10),
  /**
   * How many discovery passes have run.
   *
   * Topping up the shortlist has to be bounded by something other than the
   * lead count: a product with few manufacturers would otherwise be searched
   * again on every cycle, forever, finding the same companies each time.
   */
  discoveryRuns: integer("discovery_runs").notNull().default(0),
  /**
   * Search phrases invented from this product, used once the generic angles
   * are spent. Stored because they depend on the product and nothing else, so
   * regenerating them every round would pay for the same answer repeatedly.
   */
  searchAngles: jsonb("search_angles").$type<{ query: string; reason: string }[]>(),
  /**
   * Rounds run today, and which day that is.
   *
   * The search no longer stops at a fixed number of rounds - it stops when a
   * day passes without finding anybody - so something has to bound the cost. A
   * round is a few searches and one scoring call, which is cheap once and
   * unbounded across twelve cycles a day.
   */
  discoveryRoundsToday: integer("discovery_rounds_today").notNull().default(0),
  /** ISO date the counter above belongs to. */
  discoveryDay: text("discovery_day"),
  /**
   * When this project was granted the outreach slot.
   *
   * One project may send cold email at a time, and the slot changes hands at
   * most once a day. Both halves are needed: one-at-a-time alone lets a project
   * that finishes by ten in the morning hand over to another that sends thirty
   * more the same afternoon, and one-a-day alone lets a slow project still be
   * sending when the next one starts. Together they make "one project a day"
   * mean at most one project's worth of cold email in any day.
   *
   * Null means the project has never sent and is waiting its turn.
   */
  outreachStartedAt: timestamp("outreach_started_at", { withTimezone: true }),
  /** Set when every approved supplier has been written to. Frees the slot. */
  outreachCompletedAt: timestamp("outreach_completed_at", { withTimezone: true }),
  /**
   * Set to stop the project entirely.
   *
   * Nothing is sent, read or chased while it is set - the whole project stands
   * still rather than the setting merely being cosmetic. Different from turning
   * autonomy off, which keeps the project running and only moves the decisions
   * back to a person.
   */
  pausedAt: timestamp("paused_at", { withTimezone: true }),
  /**
   * Set to file the project away.
   *
   * Archiving always switches the project off as well - a project you have
   * finished with should not keep writing to factories from behind a filter,
   * and the two states agreeing is what makes the archive safe to use. It is
   * not a delete: everything is kept, and restoring puts it back exactly as it
   * was, still switched off until someone decides otherwise.
   */
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  /**
   * When the scheduled cycle last got to this project.
   *
   * The cycle has a deadline and processes projects in order, so with a fixed
   * order the last project is always the one that runs out of time - it was
   * skipped on every run while the first two were never skipped once. Ordering
   * by this column rotates the starvation instead of parking it on whichever
   * project happens to sort last.
   */
  lastCycledAt: timestamp("last_cycled_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Single-row application settings. Values here override the matching .env
 * entries so the operator can change the signature without a redeploy — env
 * stays the fallback for a fresh install.
 */
export const settings = pgTable("settings", {
  id: text("id").primaryKey().default("default"),
  senderName: text("sender_name"),
  senderTitle: text("sender_title"),
  sourcingMailbox: text("sourcing_mailbox"),
  companyName: text("company_name"),

  /*
   * Company-wide commercial defaults.
   *
   * These are standing rules, not project facts: the duty rate is nil unless a
   * particular RFQ says otherwise, the return target is a policy, and the
   * marketplace fees are the same on every product. Keeping them here means a
   * new project starts already answered, and the only question left for a human
   * is the one nobody can derive - what this product will sell for.
   */
  defaultTargetRoi: numeric("default_target_roi", { precision: 4, scale: 2 }).$type<string>(),
  defaultDutyRatePct: numeric("default_duty_rate_pct", { precision: 5, scale: 2 }).$type<string>(),
  defaultReferralPct: numeric("default_referral_pct", { precision: 5, scale: 2 }).$type<string>(),
  defaultPpcPct: numeric("default_ppc_pct", { precision: 5, scale: 2 }).$type<string>(),
  defaultInboundUsdPerUnit: numeric("default_inbound_usd_per_unit", {
    precision: 8,
    scale: 2,
  }).$type<string>(),

  /**
   * When the scheduled cycle last ran.
   *
   * Without it there is no way to tell a system that is working quietly from
   * one that stopped days ago - both look like a page that is not changing.
   */
  lastCycleAt: timestamp("last_cycle_at", { withTimezone: true }),
  /** Where notifications go. Separate from the sourcing mailbox on purpose. */
  notifyEmail: text("notify_email"),
  /**
   * The most cold emails one project may send in a day while it holds the slot.
   *
   * Not a budget shared across projects - only one project sends at a time, so
   * this is simply how much of its shortlist it gets through before tomorrow.
   * It is what makes the daily slot mean a number rather than an intention.
   */
  maxColdPerDay: integer("max_cold_per_day").notNull().default(30),

  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Uploaded documents — RFQ decks, quote PDFs, supplier attachments.
 * Stored as bytea: these are 1-5MB and keeping them in Postgres means one
 * backup, one deploy target, and no object-storage credentials to manage.
 * Revisit past ~10MB per file.
 */
export const files = pgTable(
  "files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    content: bytea("content").notNull(),
    kind: text("kind").$type<"rfq" | "quote" | "attachment">().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("files_project_idx").on(t.projectId)],
);

export const items = pgTable(
  "items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind").$type<ItemKind>().notNull(),
    /** Set on bundled_component — which priced item it ships inside. */
    parentItemId: uuid("parent_item_id"),
    referenceLinks: jsonb("reference_links").$type<string[]>().notNull().default([]),
    /** Empty on a priced_variant = RFQ defect (see RfqValidationIssue). */
    targetPrices: jsonb("target_prices").$type<PricePoint[]>().notNull().default([]),

    /*
     * Per-product commercials. Retail price and fulfilment fee differ between
     * variants, so they cannot live on the project: the folding basket and the
     * fixed one sell at different prices and ship in different cartons.
     */
    targetRetailUsd: numeric("target_retail_usd", { precision: 10, scale: 2 }).$type<string>(),
    fbaFeeUsd: numeric("fba_fee_usd", { precision: 8, scale: 2 }).$type<string>(),
    /**
     * Packed volume per unit, used for the walk-away before any quote exists.
     * Replaced by the real figure the moment a supplier states carton size -
     * which is why carton dimensions are a pricing input, not a shipping detail.
     */
    assumedCbmPerUnit: numeric("assumed_cbm_per_unit", { precision: 8, scale: 5 }).$type<string>(),
  },
  (t) => [index("items_project_idx").on(t.projectId)],
);

/**
 * Every change to a target price, and why.
 *
 * Overwriting the number would lose the one thing that makes a comparison
 * readable later. Three factories told us $7.70 was unreachable; if the target
 * quietly becomes $9.50, Peitai's quote turns from +31% into +6% and nothing on
 * the page explains why the same offer suddenly looks good. The gap is only
 * meaningful next to the number it was measured against.
 *
 * It is also what tells the agent who to go back to. A target that moves up
 * makes the suppliers who refused the old one worth another conversation, and a
 * target that moves down puts quotes we had accepted back in play.
 */
export const targetRevisions = pgTable(
  "target_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    /** Null when the change applied to every quantity tier at once. */
    qty: integer("qty"),
    /** Null when the RFQ never carried a target for this tier. */
    previousUsd: numeric("previous_usd", { precision: 10, scale: 2 }).$type<string>(),
    newUsd: numeric("new_usd", { precision: 10, scale: 2 }).$type<string>().notNull(),
    /** Hebrew, from the operator. Shown next to the number wherever it appears. */
    reasonHe: text("reason_he"),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("target_revisions_project_idx").on(t.projectId, t.itemId)],
);

export const requirements = pgTable(
  "requirements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** Null = applies across every item (packaging, certs, insert). */
    itemId: uuid("item_id").references(() => items.id, { onDelete: "cascade" }),
    /** Stable human-readable key, e.g. REQ_BASKET_MATERIAL. */
    key: text("key").notNull(),
    category: text("category").$type<RequirementCategory>().notNull(),
    text: text("text").notNull(),
    isMandatory: boolean("is_mandatory").notNull(),
    sourceSection: text("source_section"),
    sourcePage: integer("source_page"),
  },
  (t) => [uniqueIndex("requirements_project_key_idx").on(t.projectId, t.key)],
);

/**
 * Problems found in the RFQ itself while parsing it. These are the highest-value
 * output of the parser — a missing dimension becomes forty clarification emails
 * from suppliers — so they are persisted rather than counted and discarded.
 */
export const rfqValidationIssues = pgTable(
  "rfq_validation_issues",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    severity: text("severity").$type<"error" | "warning">().notNull(),
    code: text("code").notNull(),
    detail: text("detail").notNull(),
    sourceSection: text("source_section"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("rfq_issues_project_idx").on(t.projectId)],
);

/* ── Suppliers ────────────────────────────────────────────────────────────── */

export const suppliers = pgTable(
  "suppliers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyName: text("company_name"),
    contactName: text("contact_name"),
    companyAddress: text("company_address"),
    website: text("website"),
    email: text("email"),
    whatsapp: text("whatsapp"),
    wechat: text("wechat"),
    alibabaProfileUrl: text("alibaba_profile_url"),
    primaryChannel: text("primary_channel")
      .$type<"alibaba" | "email" | "whatsapp" | "wechat">()
      .notNull()
      .default("email"),
    /** The supplier DB accrues across projects as a by-product of sourcing. */
    firstSeenProjectId: uuid("first_seen_project_id").references(() => projects.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("suppliers_email_idx").on(t.email)],
);

/**
 * A discovery hit, before anyone has approved contacting it. Kept separate from
 * `suppliers` so the operator approval gate has something to act on and so a
 * rejected lead is never silently promoted into the permanent supplier DB.
 */
export const supplierLeads = pgTable(
  "supplier_leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** Set once approved and promoted. */
    supplierId: uuid("supplier_id").references(() => suppliers.id),
    /**
     * Set when the operator writes to this supplier themselves.
     *
     * From that point the agent stops touching the conversation - no replies,
     * no follow-ups. Someone taking over a thread by hand is making a judgement
     * the system cannot see, and a machine talking over them is worse than one
     * that says nothing.
     */
    takenOverAt: timestamp("taken_over_at", { withTimezone: true }),
    companyName: text("company_name").notNull(),
    /**
     * The dedupe key. Company names come from the model and drift between runs
     * ("China Bike Rack" one time, "Chinabikerack" the next), so keying on the
     * name let a second discovery run store the same factory twice - and let a
     * rejected lead return under a slightly different spelling. A domain does
     * not drift.
     */
    domain: text("domain").notNull().default(""),
    website: text("website"),
    email: text("email"),
    country: text("country"),
    /** Which channel surfaced it: "search" | "made-in-china" | "trade-show" | … */
    source: text("source").notNull(),
    sourceUrl: text("source_url"),
    /** 0-100. Shown next to the lead with the rationale below it. */
    matchScore: integer("match_score"),
    matchRationale: text("match_rationale"),
    emailVerified: boolean("email_verified"),
    status: text("status")
      .$type<"pending" | "approved" | "rejected" | "contacted">()
      .notNull()
      .default("pending"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decidedBy: text("decided_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("supplier_leads_project_idx").on(t.projectId, t.status),
    uniqueIndex("supplier_leads_domain_idx").on(t.projectId, t.domain),
  ],
);

/* ── Outbound ─────────────────────────────────────────────────────────────── */

export const outreach = pgTable(
  "outreach",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id),
    /** Individual send per supplier — never BCC. See the sender module. */
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    status: text("status")
      .$type<"queued" | "sent" | "bounced" | "replied" | "failed">()
      .notNull()
      .default("queued"),
    gmailMessageId: text("gmail_message_id"),
    gmailThreadId: text("gmail_thread_id"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("outreach_thread_idx").on(t.gmailThreadId)],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    supplierId: uuid("supplier_id").references(() => suppliers.id),
    direction: text("direction").$type<"inbound" | "outbound">().notNull(),
    gmailMessageId: text("gmail_message_id").notNull(),
    gmailThreadId: text("gmail_thread_id").notNull(),
    fromAddress: text("from_address"),
    subject: text("subject"),
    bodyText: text("body_text"),
    /**
     * What an outbound message was for.
     *
     * Follow-ups used to be identified by a "Chase:" prefix on the subject,
     * which was never actually applied - so every chase counted as zero chases,
     * the two-attempt limit never engaged, and the same "I have not heard back"
     * would have gone out every few days forever. Marking the row is the honest
     * version: the supplier still sees a normal "Re:", and the count comes from
     * a field that cannot silently disagree with the text.
     */
    outboundKind: text("outbound_kind").$type<"reply" | "chase" | "price_ask">(),
    /**
     * The Fiddle Leaf lesson: the numbers are in the attachment, the
     * intelligence ("over length for Amazon warehouse") is in the body.
     * Both get parsed.
     */
    attachments: jsonb("attachments")
      .$type<{ filename: string; mimeType: string; storagePath: string }[]>()
      .notNull()
      .default([]),
    /** Reply triage - drives the "supplier responded positively" notification. */
    classification: text("classification").$type<
      | "quotation"
      | "interested_needs_info"
      | "acknowledged"
      | "declined"
      | "not_relevant"
      | "unclassified"
    >(),
    /**
     * The full triage result: Hebrew summary, what they answered, what is still
     * missing, questions they asked, whether they challenged a requirement.
     * Kept whole rather than split into columns because it is read as a unit by
     * the conversation view and the shape is still moving.
     */
    analysis: jsonb("analysis").$type<{
      summary_he: string;
      questions_from_supplier: string[];
      answered: string[];
      missing: string[];
      challenges_a_requirement: boolean;
      challenge_detail: string | null;
      needs_human: boolean;
      needs_human_reason: string | null;
    } | null>(),
    /** Cleared by the operator once the reply has been dealt with. */
    handledAt: timestamp("handled_at", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("messages_gmail_id_idx").on(t.gmailMessageId),
    index("messages_thread_idx").on(t.gmailThreadId),
  ],
);

/**
 * A question the agent could not answer from the RFQ.
 *
 * This is the hand-off point of the whole system. When a supplier asks
 * something the documents already answer, the reply goes out on its own. When
 * they ask something nobody has decided - steel or aluminium - inventing an
 * answer would put a specification into a commercial negotiation that no human
 * ever approved. So the question is parked here instead, the thread waits, and
 * the moment it is answered the reply goes out and the answer is reused for
 * every other supplier who asks the same thing.
 */
export const openQuestions = pgTable(
  "open_questions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    /** Which supplier raised it. The answer is not limited to them. */
    supplierId: uuid("supplier_id").references(() => suppliers.id),
    /** The inbound message that raised it. */
    messageId: uuid("message_id").references(() => messages.id, { onDelete: "cascade" }),
    /**
     * A "project" question is a fact about the product and holds every thread
     * that needs it; a "supplier" question concerns only the one conversation.
     */
    scope: text("scope").$type<"project" | "supplier">().notNull().default("project"),
    /** As it will be put to the supplier, and as the operator reads it. */
    questionEn: text("question_en").notNull(),
    questionHe: text("question_he").notNull(),
    /** Why it blocks the reply - shown so the operator can judge urgency. */
    whyHe: text("why_he"),
    answer: text("answer"),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
    status: text("status")
      .$type<"open" | "answered" | "dismissed">()
      .notNull()
      .default("open"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("open_questions_project_idx").on(t.projectId, t.status)],
);

/**
 * A supplier's numbers as they stated them, whether or not they work.
 *
 * Separate from the `quotes` table, which models a negotiated quotation with
 * options and line items. This is the raw reading of one message: what they
 * said, what they proposed instead, and whether they refused the target. It is
 * kept for every reply that carries pricing, including refusals, because the
 * supplier who says no is often the one telling you where the floor really is.
 */
export const quoteReadings = pgTable(
  "quote_readings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id),
    /** The reply this was read from. */
    messageId: uuid("message_id").references(() => messages.id, { onDelete: "cascade" }),

    currency: text("currency").notNull().default("USD"),
    incoterm: text("incoterm"),
    incotermPlace: text("incoterm_place"),
    lines: jsonb("lines")
      .$type<
        {
          item_name: string;
          qty: number | null;
          unit_price: number | null;
          spec_note: string | null;
          /** Which RFQ product this prices, by our name. Empty for accessories. */
          matches_rfq_item?: string | null;
        }[]
      >()
      .notNull()
      .default([]),

    moq: integer("moq"),
    leadTimeDays: integer("lead_time_days"),
    paymentTerms: text("payment_terms"),
    samplePrice: numeric("sample_price", { precision: 10, scale: 2 }).$type<string>(),
    sampleLeadTimeDays: integer("sample_lead_time_days"),
    toolingCost: numeric("tooling_cost", { precision: 10, scale: 2 }).$type<string>(),
    certificates: jsonb("certificates").$type<string[]>().notNull().default([]),

    unitsPerCarton: integer("units_per_carton"),
    cartonDimensionsCm: text("carton_dimensions_cm"),
    cartonGrossWeightKg: numeric("carton_gross_weight_kg", { precision: 8, scale: 2 }).$type<string>(),

    /** Where their offer differs from what we asked for. */
    deviations: jsonb("deviations")
      .$type<{ our_requirement: string; what_they_offer: string; their_reason: string | null }[]>()
      .notNull()
      .default([]),

    rejectsTargetPrice: boolean("rejects_target_price").notNull().default(false),
    priceObjection: text("price_objection"),
    summaryHe: text("summary_he"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("quote_readings_project_idx").on(t.projectId, t.supplierId)],
);

/**
 * What has already been announced.
 *
 * The cycle runs every two hours and most of what it finds is the same thing it
 * found last time. Without a record, "you have an open question" arrives twelve
 * times a day until it is answered, and the twelfth is read exactly as
 * carefully as the first - which is to say, not at all.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"open_questions" | "project_done">().notNull(),
    /** Identifies the specific thing announced, so it is announced once. */
    dedupeKey: text("dedupe_key").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("notifications_dedupe_idx").on(t.projectId, t.kind, t.dedupeKey)],
);

/* ── Quotes ───────────────────────────────────────────────────────────────── */

export const quotes = pgTable(
  "quotes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id),
    itemId: uuid("item_id").references(() => items.id),
    messageId: uuid("message_id").references(() => messages.id),
    /** Suppliers revise. Never overwrite — append a version. */
    version: integer("version").notNull().default(1),
    sourceFile: text("source_file"),
    quoteNumber: text("quote_number"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
    validUntil: timestamp("valid_until", { withTimezone: true }),

    /** Classify the table's axis BEFORE reading any value. See schema.ts. */
    pricingAxis: text("pricing_axis").$type<PricingAxis>().notNull(),
    /** Lines and landed total can sit at different incoterms (EXW + DDP). */
    lineIncoterm: text("line_incoterm").$type<Incoterm>().notNull().default("UNKNOWN"),
    landedIncoterm: text("landed_incoterm").$type<Incoterm>(),
    freightCharge: numeric("freight_charge"),
    landedTotal: numeric("landed_total"),
    destination: text("destination"),

    currency: text("currency").notNull().default("USD"),
    leadTime: jsonb("lead_time").$type<LeadTime>(),
    paymentTerms: jsonb("payment_terms").$type<PaymentTerms>(),
    samplePrice: numeric("sample_price"),
    moq: integer("moq"),
    totals: jsonb("totals").$type<PricePoint[]>().notNull().default([]),
    tierMismatch: boolean("tier_mismatch").notNull().default(false),
    notes: text("notes"),
  },
  (t) => [
    index("quotes_project_idx").on(t.projectId),
    uniqueIndex("quotes_version_idx").on(t.supplierId, t.projectId, t.version),
  ],
);

export const quoteOptions = pgTable("quote_options", {
  id: uuid("id").primaryKey().defaultRandom(),
  quoteId: uuid("quote_id")
    .notNull()
    .references(() => quotes.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  statedTotal: numeric("stated_total"),
  computedTotal: numeric("computed_total"),
  /** Systematic 1-2 cent gaps mean the displayed prices are rounded. */
  totalDiscrepancy: numeric("total_discrepancy"),
});

export const lineItems = pgTable(
  "line_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => quotes.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    name: text("name").notNull(),
    matchedItemId: uuid("matched_item_id").references(() => items.id),
    description: text("description"),
    dimensions: text("dimensions"),
    colors: text("colors"),
    materials: text("materials"),
    certificate: text("certificate"),
    prices: jsonb("prices").$type<PricePoint[]>().notNull().default([]),
    quantity: integer("quantity"),
    /** Carton, not product — drives freight and Amazon FBA eligibility. */
    cartonDimensionsCm: text("carton_dimensions_cm"),
    unitsPerCarton: integer("units_per_carton"),
    cartonCount: integer("carton_count"),
    cbm: numeric("cbm"),
    supplierImageRef: text("supplier_image_ref"),
    ourImageRef: text("our_image_ref"),
    imageMatchVerdict: text("image_match_verdict")
      .$type<"match" | "mismatch" | "unclear" | "not_checked">()
      .notNull()
      .default("not_checked"),
    remark: text("remark"),
  },
  (t) => [index("line_items_quote_idx").on(t.quoteId)],
);

/* ── Analysis ─────────────────────────────────────────────────────────────── */

export const complianceChecks = pgTable(
  "compliance_checks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    quoteId: uuid("quote_id")
      .notNull()
      .references(() => quotes.id, { onDelete: "cascade" }),
    optionId: uuid("option_id").references(() => quoteOptions.id, { onDelete: "cascade" }),
    requirementId: uuid("requirement_id")
      .notNull()
      .references(() => requirements.id, { onDelete: "cascade" }),
    /** `disputed` ≠ `fails` — never auto-reject a supplier on disputed. */
    status: text("status").$type<ComplianceCheck["status"]>().notNull(),
    evidence: text("evidence"),
    confidence: text("confidence").$type<"high" | "medium" | "low">().notNull(),
  },
  (t) => [index("compliance_quote_idx").on(t.quoteId)],
);

/** Every `missing` check and every null contract field becomes a chase question. */
export const gaps = pgTable("gaps", {
  id: uuid("id").primaryKey().defaultRandom(),
  quoteId: uuid("quote_id")
    .notNull()
    .references(() => quotes.id, { onDelete: "cascade" }),
  field: text("field").notNull(),
  questionEn: text("question_en").notNull(),
  questionZh: text("question_zh"),
  askedAt: timestamp("asked_at", { withTimezone: true }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

export const quoteAnomalies = pgTable("quote_anomalies", {
  id: uuid("id").primaryKey().defaultRandom(),
  quoteId: uuid("quote_id")
    .notNull()
    .references(() => quotes.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  detail: text("detail").notNull(),
  costImpactAtMaxQty: numeric("cost_impact_at_max_qty"),
  suggestedQuestionEn: text("suggested_question_en"),
});

/** A supplier challenging the RFQ itself. Escalates to a human, always. */
export const requirementChallenges = pgTable("requirement_challenges", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  requirementId: uuid("requirement_id").references(() => requirements.id),
  quoteId: uuid("quote_id").references(() => quotes.id),
  supplierId: uuid("supplier_id").references(() => suppliers.id),
  claim: text("claim").notNull(),
  challengeType: text("challenge_type").notNull(),
  supportingEvidence: text("supporting_evidence"),
  supplierProposedAlternative: text("supplier_proposed_alternative"),
  /** One supplier is an excuse; five saying the same thing is a fact. */
  corroboratingSupplierIds: jsonb("corroborating_supplier_ids")
    .$type<string[]>()
    .notNull()
    .default([]),
  status: text("status")
    .$type<"open" | "under_review" | "accepted_rfq_revised" | "rejected">()
    .notNull()
    .default("open"),
});

export const negotiationMandates = pgTable("negotiation_mandates", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  itemId: uuid("item_id").references(() => items.id),
  targetPrices: jsonb("target_prices").$type<PricePoint[]>().notNull().default([]),
  /** The only input in the system with no upstream document. */
  walkawayPrices: jsonb("walkaway_prices").$type<PricePoint[]>().notNull().default([]),
  minGrossMarginPct: numeric("min_gross_margin_pct"),
  acceptableIncoterms: jsonb("acceptable_incoterms").$type<Incoterm[]>().notNull().default([]),
  maxLeadTimeDays: integer("max_lead_time_days"),
  mandatoryCertifications: jsonb("mandatory_certifications").$type<string[]>().notNull().default([]),
  maxToolingCost: numeric("max_tooling_cost"),
  maxRounds: integer("max_rounds").notNull().default(4),
  maxAutonomyTier: integer("max_autonomy_tier").notNull().default(1),
  escalationTriggers: jsonb("escalation_triggers").$type<string[]>().notNull().default([]),
});
