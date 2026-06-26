import { Router } from "express";
import { requireAdmin } from "../middleware/requireAdmin";
import type { WebhookDispatcher } from "../services/webhookDispatcher";
import type { DlqRow, WebhookStore } from "../services/webhookStore";

/**
 * Admin-only webhook dead-letter routes.
 *
 *   GET  /api/admin/webhooks/dlq            -> paginated DLQ listing
 *   POST /api/admin/webhooks/dlq/:id/replay -> re-enqueue a dead-lettered delivery
 *
 * Every route is guarded by `requireAdmin` (401 unauthenticated, 403 non-admin).
 * Built as a factory so the store and dispatcher can be injected in tests.
 */
export interface AdminWebhookDeps {
  store: WebhookStore;
  dispatcher: WebhookDispatcher;
}

/** Shape the DLQ row for the API: payload bytes are exposed as base64, never raw. */
function serializeDlqRow(row: DlqRow) {
  return {
    id: row.id,
    originalId: row.originalId,
    eventId: row.eventId,
    eventType: row.eventType,
    targetUrl: row.targetUrl,
    payloadBase64: row.payload.toString("base64"),
    signature: row.signature,
    headers: row.headers,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    lastError: row.lastError,
    failedAt: row.failedAt.toISOString(),
    replayedAt: row.replayedAt ? row.replayedAt.toISOString() : null,
    replayDeliveryId: row.replayDeliveryId,
  };
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createAdminWebhooksRouter(deps: AdminWebhookDeps): Router {
  const router = Router();
  router.use(requireAdmin);

  // GET /api/admin/webhooks/dlq?cursor=<opaque>&limit=<n>
  router.get("/dlq", async (req, res, next) => {
    try {
      const page = await deps.store.listDlq(req.query.cursor, req.query.limit);
      return res.json({
        data: page.data.map(serializeDlqRow),
        nextCursor: page.nextCursor,
      });
    } catch (e) {
      return next(e);
    }
  });

  // POST /api/admin/webhooks/dlq/:id/replay
  router.post("/dlq/:id/replay", async (req, res, next) => {
    try {
      const { id } = req.params;
      if (!UUID_RE.test(id)) {
        return res.status(400).json({ error: { code: "invalid_id" } });
      }

      const row = await deps.store.getDlqRow(id);
      if (!row) {
        return res.status(404).json({ error: { code: "not_found" } });
      }
      if (row.replayedAt) {
        // Already replayed — surface the existing fresh delivery, don't dup.
        return res.status(409).json({
          error: { code: "already_replayed" },
          replayDeliveryId: row.replayDeliveryId,
        });
      }

      const fresh = await deps.dispatcher.replayFromDlq(row);
      if (!fresh) {
        // Lost the idempotency race between the check above and the write.
        return res.status(409).json({ error: { code: "already_replayed" } });
      }

      // 202 Accepted: the fresh delivery is queued, not yet delivered.
      return res.status(202).json({
        data: { deliveryId: fresh.id, status: fresh.status, attempts: fresh.attempts },
      });
    } catch (e) {
      return next(e);
    }
  });

  return router;
}
