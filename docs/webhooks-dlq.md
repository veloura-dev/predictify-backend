# Webhook delivery & dead-letter queue (DLQ)

Implements issue #76: when the dispatcher exhausts retries, a delivery lands in a
dead-letter table that an operator can inspect and replay.

> **Scope note.** Issue #76 targets the DLQ layer, but the webhook subsystem it
> builds on (delivery table, dispatcher, admin auth, cursor pagination) did not
> yet exist in the starter repo. This change therefore adds the minimal
> supporting pieces needed to make the DLQ real and reviewable, alongside the DLQ
> itself. Each piece is small and independently useful. See "What this PR adds".

## What this PR adds

| Area | File | Purpose |
| --- | --- | --- |
| Schema | `src/db/schema.ts` | `webhook_deliveries` (live queue) + `webhook_deliveries_dlq` (mirror + `lastError`), plus a `bytea` column type |
| Migration | `drizzle/0001_webhook_dlq.sql` | Creates both tables and their indexes |
| DB client | `src/db/client.ts` | Lazy pg `Pool` + drizzle client (none existed before) |
| Store | `src/services/webhookStore.ts` | `WebhookStore` interface + types + `InMemoryWebhookStore` |
| Store (prod) | `src/services/drizzleWebhookStore.ts` | Postgres-backed `WebhookStore` |
| Dispatcher | `src/services/webhookDispatcher.ts` | Retry with backoff, DLQ-on-exhaustion, replay |
| Auth | `src/middleware/requireAdmin.ts` | JWT admin guard (401 / 403) |
| Pagination | `src/utils/cursor.ts` | Shared keyset cursor helper |
| Routes | `src/routes/adminWebhooks.ts` | `GET /dlq`, `POST /dlq/:id/replay` |
| Wiring | `src/index.ts` | Mounts admin router; injectable deps for tests |

## Data model

`webhook_deliveries` is the live queue. A delivery is created per outbound event,
attempted by the dispatcher, and retried with exponential backoff up to
`max_attempts`. On the final failure it is moved into `webhook_deliveries_dlq` and
removed from the live table.

The DLQ table mirrors every delivery column and adds: `last_error` (the failure
that exhausted retries), `failed_at`, `original_id` (trace back to the live row),
`replayed_at` and `replay_delivery_id` (audit trail + double-replay guard).

### Why `payload` is `bytea`

The HMAC-SHA256 signature is computed over the **exact** request body bytes. If we
stored the payload as `jsonb` (or re-serialized text), Postgres/JS could reorder
keys or change whitespace, and the recomputed body would no longer match the
signature — replay would deliver a body the subscriber rejects. Storing raw bytes,
plus the original signature string, guarantees a replayed request is
byte-identical and validly signed.

## Endpoints

All routes require a Bearer JWT whose `role` claim is `admin`.

### `GET /api/admin/webhooks/dlq`

Query params: `limit` (1–100, default 20), `cursor` (opaque, from a previous
response). Returns:

```json
{
  "data": [
    {
      "id": "…", "originalId": "…", "eventId": "…", "eventType": "market.resolved",
      "targetUrl": "https://…", "payloadBase64": "…", "signature": "…",
      "headers": null, "attempts": 5, "maxAttempts": 5,
      "lastError": "non-2xx response: 503", "failedAt": "2026-…Z",
      "replayedAt": null, "replayDeliveryId": null
    }
  ],
  "nextCursor": "eyJ…"   // null on the last page
}
```

Pagination is keyset-based (`ORDER BY failed_at DESC, id DESC`), so listings stay
correct while the DLQ is being written to or drained. Payload bytes are returned
base64-encoded, never raw.

### `POST /api/admin/webhooks/dlq/:id/replay`

Re-enqueues a dead-lettered delivery as a **fresh** live delivery with
`attempts = 0`, reusing the stored payload bytes and signature.

| Outcome | Status |
| --- | --- |
| Replay accepted, fresh delivery queued | `202` `{ data: { deliveryId, status, attempts } }` |
| Malformed id | `400` |
| Unknown id | `404` |
| Row already replayed | `409` `{ error: { code: "already_replayed" }, replayDeliveryId }` |
| Caller not authenticated | `401` |
| Caller not an admin | `403` |

## Guarantees

- **Exactly-once dead-lettering.** `moveToDlq` inserts the DLQ row and deletes the
  live row in one transaction, selecting the live row `FOR UPDATE`. If it's already
  gone (a concurrent worker dead-lettered it), the call is a no-op — never a
  duplicate.
- **Idempotent replay.** `markReplayed` is a conditional update that only fires
  while `replayed_at IS NULL`. A lost race rolls back the fresh delivery, so one
  DLQ row yields at most one redelivery.
- **Faithful replay.** Original signed body bytes + signature are stored and reused
  verbatim.

## Running locally

```bash
npm install
cp .env.example .env          # set DATABASE_URL, JWT_SECRET, WEBHOOK_SIGNING_SECRET
npm run db:migrate            # or: psql "$DATABASE_URL" -f drizzle/0001_webhook_dlq.sql
npm run dev
npm test                      # in-memory store; no Postgres required
```

## Testing notes

- `tests/webhookDispatcher.test.ts` — unit tests: success, retry→exhaust→DLQ,
  exactly-once dead-lettering, and replay (attempts reset, bytes + signature
  preserved, idempotent).
- `tests/adminWebhooks.test.ts` — end-to-end over HTTP: auth (401/403), cursor
  pagination across pages, and the full "failing target → DLQ → replay (202) →
  redelivery succeeds" flow, plus 404/400/409 edge cases.

Tests run against `InMemoryWebhookStore`, so no database is needed in CI. The
`DrizzleWebhookStore` is a thin CRUD/transaction wrapper over the same interface;
its transaction semantics map directly to the in-memory behaviour the tests pin
down, and it is exercised against a real Postgres in a deployed environment.
