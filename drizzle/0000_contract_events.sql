CREATE TABLE IF NOT EXISTS "contract_events" (
	"id" text PRIMARY KEY NOT NULL,
	"ledger" integer NOT NULL,
	"contract_id" text,
	"type" text NOT NULL,
	"tx_hash" text NOT NULL,
	"ledger_closed_at" timestamp with time zone NOT NULL,
	"topic" jsonb NOT NULL,
	"value" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contract_events_ledger_idx" ON "contract_events" ("ledger");
