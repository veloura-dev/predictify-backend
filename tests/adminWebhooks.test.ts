import request from "supertest";
import jwt from "jsonwebtoken";
import { createApp } from "../src/index";
import { WebhookDispatcher, type HttpSender } from "../src/services/webhookDispatcher";
import { InMemoryWebhookStore } from "../src/services/webhookStore";

const JWT_SECRET = "test-jwt-secret-at-least-32-bytes-long-000000";
const SIGNING_SECRET = "test-webhook-signing-secret";

function token(role?: string) {
  return jwt.sign({ sub: "user_1", ...(role ? { role } : {}) }, JWT_SECRET, {
    issuer: "predictify",
    audience: "predictify-app",
    expiresIn: "5m",
  });
}
const adminAuth = { Authorization: `Bearer ${token("admin")}` };

/** Build an app whose webhook deps share a controllable in-memory store. */
function buildHarness(send: HttpSender) {
  const store = new InMemoryWebhookStore();
  const dispatcher = new WebhookDispatcher({
    store,
    send,
    signingSecret: SIGNING_SECRET,
    backoffMs: () => 0,
  });
  const app = createApp({ webhooks: { store, dispatcher } });
  return { app, store, dispatcher };
}

// A target that fails until `flip()` is called, then succeeds.
function flakyTarget() {
  let healthy = false;
  const send: HttpSender = async () => ({ status: healthy ? 200 : 500 });
  return { send, flip: () => (healthy = true) };
}

describe("admin webhook DLQ routes", () => {
  describe("auth", () => {
    it("returns 401 with no token", async () => {
      const { app } = buildHarness(async () => ({ status: 200 }));
      const res = await request(app).get("/api/admin/webhooks/dlq");
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("unauthorized");
    });

    it("returns 403 for a non-admin caller", async () => {
      const { app } = buildHarness(async () => ({ status: 200 }));
      const res = await request(app)
        .get("/api/admin/webhooks/dlq")
        .set("Authorization", `Bearer ${token("user")}`);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("forbidden");
    });

    it("returns 401 for a token with a bad signature", async () => {
      const { app } = buildHarness(async () => ({ status: 200 }));
      const forged = jwt.sign({ sub: "x", role: "admin" }, "wrong-secret", {
        issuer: "predictify",
        audience: "predictify-app",
      });
      const res = await request(app)
        .get("/api/admin/webhooks/dlq")
        .set("Authorization", `Bearer ${forged}`);
      expect(res.status).toBe(401);
    });
  });

  describe("GET /dlq", () => {
    it("lists dead-lettered deliveries and paginates via cursor", async () => {
      const { app, dispatcher } = buildHarness(async () => ({ status: 500 }));
      // Dead-letter 3 deliveries.
      for (let i = 0; i < 3; i++) {
        const d = await dispatcher.enqueue({
          eventId: `evt_${i}`,
          eventType: "market.resolved",
          targetUrl: "https://example.test/hook",
          payload: Buffer.from(`body-${i}`),
          maxAttempts: 1,
        });
        await dispatcher.attemptDelivery(d.id);
      }

      const page1 = await request(app)
        .get("/api/admin/webhooks/dlq?limit=2")
        .set(adminAuth);
      expect(page1.status).toBe(200);
      expect(page1.body.data).toHaveLength(2);
      expect(page1.body.nextCursor).toBeTruthy();
      // payload is exposed as base64, never raw bytes
      expect(page1.body.data[0].payloadBase64).toBeTruthy();

      const page2 = await request(app)
        .get(`/api/admin/webhooks/dlq?limit=2&cursor=${encodeURIComponent(page1.body.nextCursor)}`)
        .set(adminAuth);
      expect(page2.status).toBe(200);
      expect(page2.body.data).toHaveLength(1);
      expect(page2.body.nextCursor).toBeNull();

      // No overlap between pages.
      const ids = new Set(page1.body.data.map((r: { id: string }) => r.id));
      expect(ids.has(page2.body.data[0].id)).toBe(false);
    });
  });

  describe("POST /dlq/:id/replay", () => {
    it("end-to-end: failing target dead-letters, replay returns 202, redelivery succeeds", async () => {
      const target = flakyTarget();
      const { app, store, dispatcher } = buildHarness(target.send);

      // 1. Delivery fails and lands in the DLQ.
      const original = Buffer.from(JSON.stringify({ market: "m1", outcome: "yes" }));
      const d = await dispatcher.enqueue({
        eventId: "evt_replay",
        eventType: "market.resolved",
        targetUrl: "https://example.test/hook",
        payload: original,
        maxAttempts: 2,
      });
      await dispatcher.attemptDelivery(d.id);
      await dispatcher.attemptDelivery(d.id); // exhausts -> DLQ
      const [dlqRow] = (await store.listDlq(undefined, 50)).data;
      expect(dlqRow).toBeDefined();

      // 2. Operator replays -> 202 + a fresh delivery id.
      const replay = await request(app)
        .post(`/api/admin/webhooks/dlq/${dlqRow.id}/replay`)
        .set(adminAuth);
      expect(replay.status).toBe(202);
      const newId = replay.body.data.deliveryId;
      expect(newId).toBeTruthy();
      expect(newId).not.toBe(d.id);
      expect(replay.body.data.attempts).toBe(0);

      // 3. Target recovers; the replayed delivery now succeeds with identical bytes.
      target.flip();
      const fresh = await store.getDelivery(newId);
      expect(fresh!.payload.equals(original)).toBe(true);
      const result = await dispatcher.attemptDelivery(newId);
      expect(result).toBe("delivered");
    });

    it("returns 404 for an unknown DLQ id", async () => {
      const { app } = buildHarness(async () => ({ status: 200 }));
      const res = await request(app)
        .post("/api/admin/webhooks/dlq/11111111-1111-4111-8111-111111111111/replay")
        .set(adminAuth);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("not_found");
    });

    it("returns 400 for a malformed id", async () => {
      const { app } = buildHarness(async () => ({ status: 200 }));
      const res = await request(app)
        .post("/api/admin/webhooks/dlq/not-a-uuid/replay")
        .set(adminAuth);
      expect(res.status).toBe(400);
    });

    it("returns 409 when replaying an already-replayed row", async () => {
      const { app, store, dispatcher } = buildHarness(async () => ({ status: 500 }));
      const d = await dispatcher.enqueue({
        eventId: "evt_dup",
        eventType: "x",
        targetUrl: "https://example.test/hook",
        payload: Buffer.from("p"),
        maxAttempts: 1,
      });
      await dispatcher.attemptDelivery(d.id);
      const [dlqRow] = (await store.listDlq(undefined, 50)).data;

      const first = await request(app)
        .post(`/api/admin/webhooks/dlq/${dlqRow.id}/replay`)
        .set(adminAuth);
      expect(first.status).toBe(202);

      const second = await request(app)
        .post(`/api/admin/webhooks/dlq/${dlqRow.id}/replay`)
        .set(adminAuth);
      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe("already_replayed");
    });

    it("rejects replay for a non-admin caller (403)", async () => {
      const { app, store, dispatcher } = buildHarness(async () => ({ status: 500 }));
      const d = await dispatcher.enqueue({
        eventId: "evt_x",
        eventType: "x",
        targetUrl: "https://example.test/hook",
        payload: Buffer.from("p"),
        maxAttempts: 1,
      });
      await dispatcher.attemptDelivery(d.id);
      const [dlqRow] = (await store.listDlq(undefined, 50)).data;

      const res = await request(app)
        .post(`/api/admin/webhooks/dlq/${dlqRow.id}/replay`)
        .set("Authorization", `Bearer ${token("user")}`);
      expect(res.status).toBe(403);
    });
  });
});
