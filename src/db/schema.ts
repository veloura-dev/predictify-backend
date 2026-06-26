import { pgTable, uuid, text, timestamp, integer, boolean, jsonb, index } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  stellarAddress: text("stellar_address").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const markets = pgTable("markets", {
  id: text("id").primaryKey(),
  question: text("question").notNull(),
  status: text("status").notNull(),
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

// Raw Soroban contract events ingested by the indexer worker. The event `id`
// returned by the RPC is globally unique and used as the primary key so that
// re-fetching an overlapping ledger range is naturally idempotent.
export const contractEvents = pgTable("contract_events", {
  id: text("id").primaryKey(),
  ledger: integer("ledger").notNull(),
  contractId: text("contract_id"),
  type: text("type").notNull(),
  txHash: text("tx_hash").notNull(),
  ledgerClosedAt: timestamp("ledger_closed_at", { withTimezone: true }).notNull(),
  topic: jsonb("topic").notNull(),
  value: jsonb("value").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  ledgerIdx: index("contract_events_ledger_idx").on(t.ledger),
}));
