CREATE TABLE IF NOT EXISTS "notification_preferences" (
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "category" text NOT NULL,
  "channel" text NOT NULL,
  "enabled" boolean NOT NULL DEFAULT true,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("user_id", "category", "channel")
);

CREATE INDEX IF NOT EXISTS "notification_preferences_user_id_idx"
  ON "notification_preferences" ("user_id");
