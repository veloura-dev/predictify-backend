import {
  WebhookDispatcher,
  type HttpSender,
} from "../src/services/webhookDispatcher";
import { InMemoryWebhookStore } from "../src/services/webhookStore";

const SECRET = "test-webhook-signing-secret";

function makeDispatcher(send: HttpSender, store = new InMemoryWebhookStore()) {
  const dispatcher = new WebhookDispatcher({
    store,
    send,
    signingSecret: SECRET,
    backoffMs: () => 0, // no real waiting in tests
  });
  return { dispatcher, store };
}

const okSender: HttpSender = async () => ({ status: 200 });
const failSender: HttpSender = async () => ({ status: 500 });

describe("WebhookDispatcher", () => {
  it("delivers on first success and records the signature", async () => {
    const { dispatcher, store } = makeDispatcher(okSender);
    const d = await dispatcher.enqueue({
      eventId: "evt_1",
      eventType: "market.resolved",
      targetUrl: "https://example.test/hook",
      payload: Buffer.from(JSON.stringify({ a: 1 })),
    });
    expect(dispatcher.verify(d.payload, d.signature)).toBe(true);

    const result = await dispatcher.attemptDelivery(d.id);
    expect(result).toBe("delivered");
    const after = await store.getDelivery(d.id);
    expect(after?.status).toBe("delivered");
    expect(after?.attempts).toBe(1);
  });

  it("retries until maxAttempts, then dead-letters exactly once", async () => {
    let calls = 0;
    const counting: HttpSender = async () => {
      calls += 1;
      return { status: 503 };
    };
    const { dispatcher, store } = makeDispatcher(counting);
    const d = await dispatcher.enqueue({
      eventId: "evt_2",
      eventType: "market.resolved",
      targetUrl: "https://example.test/hook",
      payload: Buffer.from("payload-bytes"),
      maxAttempts: 3,
    });

    expect(await dispatcher.attemptDelivery(d.id)).toBe("retry");
    expect(await dispatcher.attemptDelivery(d.id)).toBe("retry");
    expect(await dispatcher.attemptDelivery(d.id)).toBe("dead-lettered");

    expect(calls).toBe(3);
    // Live row is gone, exactly one DLQ row exists.
    expect(await store.getDelivery(d.id)).toBeNull();
    const page = await store.listDlq(undefined, 50);
    expect(page.data).toHaveLength(1);
    expect(page.data[0].originalId).toBe(d.id);
    expect(page.data[0].lastError).toContain("503");
    expect(page.data[0].attempts).toBe(3);
  });

  it("never dead-letters the same delivery twice (idempotent moveToDlq)", async () => {
    const { dispatcher, store } = makeDispatcher(failSender);
    const d = await dispatcher.enqueue({
      eventId: "evt_3",
      eventType: "x",
      targetUrl: "https://example.test/hook",
      payload: Buffer.from("p"),
      maxAttempts: 1,
    });
    // First attempt exhausts (maxAttempts=1) and dead-letters.
    expect(await dispatcher.attemptDelivery(d.id)).toBe("dead-lettered");
    // A stray second attempt on the now-missing live row is a no-op.
    expect(await dispatcher.attemptDelivery(d.id)).toBe("gone");

    const page = await store.listDlq(undefined, 50);
    expect(page.data).toHaveLength(1);
  });

  it("replays a DLQ row into a fresh live delivery with attempts reset and bytes intact", async () => {
    const store = new InMemoryWebhookStore();
    const original = Buffer.from(JSON.stringify({ market: "m1", outcome: "yes" }));

    // First a failing target dead-letters the delivery...
    const { dispatcher } = makeDispatcher(failSender, store);
    const d = await dispatcher.enqueue({
      eventId: "evt_4",
      eventType: "market.resolved",
      targetUrl: "https://example.test/hook",
      payload: original,
      maxAttempts: 1,
    });
    const sig = d.signature;
    await dispatcher.attemptDelivery(d.id);
    const [dlqRow] = (await store.listDlq(undefined, 50)).data;

    // ...then replay produces a fresh, byte-identical, validly-signed delivery.
    const fresh = await dispatcher.replayFromDlq(dlqRow);
    expect(fresh).not.toBeNull();
    expect(fresh!.attempts).toBe(0);
    expect(fresh!.status).toBe("pending");
    expect(fresh!.id).not.toBe(d.id);
    expect(fresh!.payload.equals(original)).toBe(true); // signed bytes preserved
    expect(fresh!.signature).toBe(sig); // signature preserved
    expect(dispatcher.verify(fresh!.payload, fresh!.signature)).toBe(true);

    // Replaying the same row again is rejected (idempotent).
    const second = await dispatcher.replayFromDlq(dlqRow);
    expect(second).toBeNull();
  });
});
