-- Indexer events and cursor tables for Soroban ingestion and gap detection.

CREATE TABLE IF NOT EXISTS "indexer_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "ledger" integer NOT NULL,
  "tx_hash" text NOT NULL,
  "op_index" integer NOT NULL,
  "event_type" text,
  "payload" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "indexer_events_ledger_tx_op_idx"
  ON "indexer_events" ("ledger", "tx_hash", "op_index");

CREATE INDEX IF NOT EXISTS "indexer_events_ledger_idx"
  ON "indexer_events" ("ledger");

CREATE TABLE IF NOT EXISTS "indexer_cursor" (
  "id" integer PRIMARY KEY NOT NULL,
  "last_ledger" integer NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
