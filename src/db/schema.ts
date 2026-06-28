import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  stellarAddress: text("stellar_address").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const authChallenges = pgTable("auth_challenges", {
  nonce: text("nonce").primaryKey(),
  stellarAddress: text("stellar_address").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  used: boolean("used").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const refreshTokens = pgTable("refresh_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  tokenHash: text("token_hash").notNull().unique(),
  familyId: uuid("family_id").notNull(),
  parentId: uuid("parent_id"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const webhookSubscriptions = pgTable("webhook_subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  url: text("url").notNull(),
  secret: text("secret").notNull(),
  events: jsonb("events").notNull().default([]),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const webhookDeliveries = pgTable("webhook_deliveries", {
  id: uuid("id").primaryKey().defaultRandom(),
  subscriptionId: uuid("subscription_id")
    .notNull()
    .references(() => webhookSubscriptions.id),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload").notNull(),
  status: text("status").notNull().default("pending"),
  attempt: integer("attempt").notNull().default(0),
  nextRetryAt: timestamp("next_retry_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastStatusCode: integer("last_status_code"),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const webhookDeliveriesDlq = pgTable("webhook_deliveries_dlq", {
  id: uuid("id").primaryKey().defaultRandom(),
  subscriptionId: uuid("subscription_id")
    .notNull()
    .references(() => webhookSubscriptions.id),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload").notNull(),
  status: text("status").notNull().default("dlq"),
  attempt: integer("attempt").notNull().default(0),
  nextRetryAt: timestamp("next_retry_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastStatusCode: integer("last_status_code"),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const markets = pgTable("markets", {
  id: text("id").primaryKey(),
  question: text("question").notNull(),
  status: text("status").notNull(),
  resolutionOutcome: text("resolution_outcome"),
  resolutionTime: timestamp("resolution_time", {
    withTimezone: true,
  }).notNull(),
  winningOutcome: text("winning_outcome"),
  metadata: jsonb("metadata"),
  indexedLedger: integer("indexed_ledger").notNull(),
  archived: boolean("archived").notNull().default(false),
  version: integer("version").notNull().default(1),
});

export const marketAuditLog = pgTable("market_audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  marketId: text("market_id")
    .notNull()
    .references(() => markets.id),
  adminAddress: text("admin_address").notNull(),
  action: text("action").notNull(),
  beforeState: jsonb("before_state").notNull(),
  afterState: jsonb("after_state").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const predictions = pgTable("predictions", {
  id: uuid("id").primaryKey().defaultRandom(),
  marketId: text("market_id")
    .notNull()
    .references(() => markets.id),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  outcome: text("outcome").notNull(),
  amount: text("amount").notNull(),
  txHash: text("tx_hash").notNull().default(""),
  status: text("status").notNull().default("pending"),
  result: text("result"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const claims = pgTable("claims", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  marketId: text("market_id")
    .notNull()
    .references(() => markets.id),
  amount: text("amount").notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const disputes = pgTable("disputes", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  openedBy: uuid("user_id")
    .notNull()
    .references(() => users.id),
  marketId: text("market_id")
    .notNull()
    .references(() => markets.id),
  reason: text("reason").notNull(),
  evidenceUri: text("evidence_uri"),
  status: text("status").notNull().default("open"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const adminAuditLog = pgTable("admin_audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  adminAddress: text("admin_address").notNull(),
  action: text("action").notNull(),
  targetAddress: text("target_address").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const indexerCursor = pgTable("indexer_cursor", {
  id: integer("id").primaryKey(),
  lastLedger: integer("last_ledger").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const contractEvents = pgTable("contract_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  contractId: text("contract_id").notNull(),
  ledger: integer("ledger").notNull(),
  txHash: text("tx_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const indexerEvents = pgTable("indexer_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  ledger: integer("ledger").notNull(),
  txHash: text("tx_hash").notNull(),
  opIndex: integer("op_index").notNull().default(0),
  eventType: text("event_type").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type IndexerEvent = typeof indexerEvents.$inferSelect;

export const idempotencyRecords = pgTable(
  "idempotency_records",
  {
    key: text("key").primaryKey(),
    fingerprint: text("fingerprint").notNull(),
    responseStatus: integer("response_status").notNull(),
    responseBody: jsonb("response_body").notNull(),
    responseHeaders: jsonb("response_headers").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => ({
    idempotencyExpiresIdx: index("idempotency_expires_idx").on(t.expiresAt),
  }),
);

export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    channel: text("channel").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.category, t.channel] }),
    notificationPreferencesUserIdIdx: index(
      "notification_preferences_user_id_idx",
    ).on(t.userId),
  }),
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    action: text("action").notNull(),
    walletAddress: text("wallet_address"),
    ip: text("ip").notNull(),
    correlationId: text("correlation_id").notNull(),
    rateLimitContext: jsonb("rate_limit_context"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    auditLogsCorrelationIdx: index("audit_logs_correlation_idx").on(
      t.correlationId,
    ),
    auditLogsCreatedAtIdx: index("audit_logs_created_at_idx").on(t.createdAt),
  }),
);
