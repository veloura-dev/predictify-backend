-- Migration: webhook delivery queue + dead-letter table
-- Issue #76: Webhook delivery DLQ table and admin replay endpoint
--
-- Apply with `npm run db:migrate` (drizzle-kit), or psql -f this file.
-- `payload` is BYTEA so the original signed body bytes are stored verbatim;
-- re-serializing JSON would change the bytes and break signature validation.

CREATE TABLE IF NOT EXISTS "webhook_deliveries" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "event_id"        text NOT NULL,
  "event_type"      text NOT NULL,
  "target_url"      text NOT NULL,
  "payload"         bytea NOT NULL,
  "signature"       text NOT NULL,
  "headers"         jsonb,
  "status"          text NOT NULL DEFAULT 'pending',
  "attempts"        integer NOT NULL DEFAULT 0,
  "max_attempts"    integer NOT NULL DEFAULT 5,
  "last_error"      text,
  "next_attempt_at" timestamptz,
  "created_at"      timestamptz NOT NULL DEFAULT now(),
  "updated_at"      timestamptz NOT NULL DEFAULT now()
);

-- Worker scan: due, not-yet-delivered deliveries, oldest first.
CREATE INDEX IF NOT EXISTS "webhook_deliveries_due_idx"
  ON "webhook_deliveries" ("status", "next_attempt_at");

CREATE TABLE IF NOT EXISTS "webhook_deliveries_dlq" (
  "id"                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "original_id"        uuid NOT NULL,
  "event_id"           text NOT NULL,
  "event_type"         text NOT NULL,
  "target_url"         text NOT NULL,
  "payload"            bytea NOT NULL,
  "signature"          text NOT NULL,
  "headers"            jsonb,
  "attempts"           integer NOT NULL,
  "max_attempts"       integer NOT NULL,
  "last_error"         text NOT NULL,
  "failed_at"          timestamptz NOT NULL DEFAULT now(),
  "replayed_at"        timestamptz,
  "replay_delivery_id" uuid
);

-- Keyset pagination for the admin listing: ORDER BY failed_at DESC, id DESC.
CREATE INDEX IF NOT EXISTS "webhook_deliveries_dlq_failed_at_idx"
  ON "webhook_deliveries_dlq" ("failed_at" DESC, "id" DESC);
