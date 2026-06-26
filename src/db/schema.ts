import { pgTable, uuid, text, timestamp, integer, boolean, jsonb, customType } from "drizzle-orm/pg-core";

/**
 * Raw `bytea` column. We deliberately store the webhook payload as raw bytes
 * (not jsonb / re-serialized text) because the HMAC signature is computed over
 * the *exact* byte sequence that was originally sent. Re-serializing JSON can
 * reorder keys or change whitespace, which would invalidate the signature and
 * break faithful replay. See docs/webhooks-dlq.md.
 */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  stellarAddress: text("stellar_address").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const markets = pgTable("markets", {
  id: text("id").primaryKey(),
  question: text("question").notNull(),
  status: text("status").notNull(),
  resolutionOutcome: text("resolution_outcome"),
  resolutionTime: timestamp("resolution_time", { withTimezone: true }).notNull(),
  metadata: jsonb("metadata"),
  indexedLedger: integer("indexed_ledger").notNull(),
  archived: boolean("archived").notNull().default(false),
});

export const predictions = pgTable("predictions", {
  id: uuid("id").primaryKey().defaultRandom(),
  marketId: text("market_id").notNull().references(() => markets.id),
  userId: uuid("user_id").notNull().references(() => users.id),
  outcome: text("outcome").notNull(),
  amount: text("amount").notNull(),
  txHash: text("tx_hash").notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  uniqueUserMarketTx: unique().on(table.userId, table.marketId, table.txHash),
}));

export const indexerCursor = pgTable("indexer_cursor", {
  id: integer("id").primaryKey(),
  lastLedger: integer("last_ledger").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Live webhook delivery queue.
 *
 * A delivery is created when a domain event needs to be pushed to a subscriber
 * URL. The dispatcher attempts delivery, retrying with backoff up to
 * `maxAttempts`. When retries are exhausted the row is moved into
 * `webhook_deliveries_dlq` (see below) and removed from this table.
 *
 * `payload` holds the original signed body bytes and `signature` the header
 * value computed over them, so a replay re-sends a byte-identical request.
 */
export const webhookDeliveries = pgTable("webhook_deliveries", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: text("event_id").notNull(),
  eventType: text("event_type").notNull(),
  targetUrl: text("target_url").notNull(),
  payload: bytea("payload").notNull(),
  signature: text("signature").notNull(),
  headers: jsonb("headers").$type<Record<string, string>>(),
  status: text("status").notNull().default("pending"), // pending | delivered | failed
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(5),
  lastError: text("last_error"),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Dead-letter table. Mirrors every column of `webhook_deliveries` plus:
 *   - `lastError`     : the final error that exhausted retries (also present on
 *                       the live table, kept here for operator inspection)
 *   - `failedAt`      : when the delivery was dead-lettered
 *   - `originalId`    : the live delivery id, for traceability
 *   - `replayedAt`    : set once an operator replays the row (prevents double
 *                       replay and gives an audit trail)
 *   - `replayDeliveryId` : the id of the fresh live delivery created on replay
 */
export const webhookDeliveriesDlq = pgTable("webhook_deliveries_dlq", {
  id: uuid("id").primaryKey().defaultRandom(),
  originalId: uuid("original_id").notNull(),
  eventId: text("event_id").notNull(),
  eventType: text("event_type").notNull(),
  targetUrl: text("target_url").notNull(),
  payload: bytea("payload").notNull(),
  signature: text("signature").notNull(),
  headers: jsonb("headers").$type<Record<string, string>>(),
  attempts: integer("attempts").notNull(),
  maxAttempts: integer("max_attempts").notNull(),
  lastError: text("last_error").notNull(),
  failedAt: timestamp("failed_at", { withTimezone: true }).notNull().defaultNow(),
  replayedAt: timestamp("replayed_at", { withTimezone: true }),
  replayDeliveryId: uuid("replay_delivery_id"),
});
