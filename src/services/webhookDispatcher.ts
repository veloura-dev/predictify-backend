import { createHmac, timingSafeEqual } from "node:crypto";
import { logger } from "../config/logger";
import type { DlqRow, NewDelivery, WebhookDelivery, WebhookStore } from "./webhookStore";

/**
 * Webhook dispatcher.
 *
 * Responsibilities:
 *   1. Sign and enqueue outbound webhooks (`enqueue`).
 *   2. Attempt delivery with bounded retries (`attemptDelivery`).
 *   3. On the final failed attempt, move the delivery into the DLQ exactly once.
 *   4. Re-enqueue a DLQ row on operator replay, byte-for-byte (`replayFromDlq`).
 *
 * The HTTP transport is injected (`HttpSender`) so tests can simulate a target
 * that fails N times then succeeds without real network calls.
 */

export type HttpSender = (req: {
  url: string;
  body: Buffer;
  headers: Record<string, string>;
}) => Promise<{ status: number }>;

/** Default transport built on global fetch (Node >= 20). */
export const fetchSender: HttpSender = async ({ url, body, headers }) => {
  const res = await fetch(url, { method: "POST", body, headers });
  return { status: res.status };
};

const SIGNATURE_HEADER = "x-predictify-signature";

export interface DispatcherOptions {
  store: WebhookStore;
  send?: HttpSender;
  signingSecret: string;
  /** Backoff for attempt N (1-based). Default: exponential 1s,2s,4s,… capped 5m. */
  backoffMs?: (attempt: number) => number;
}

const defaultBackoff = (attempt: number): number =>
  Math.min(2 ** (attempt - 1) * 1000, 5 * 60 * 1000);

export class WebhookDispatcher {
  private readonly store: WebhookStore;
  private readonly send: HttpSender;
  private readonly secret: string;
  private readonly backoffMs: (attempt: number) => number;

  constructor(opts: DispatcherOptions) {
    this.store = opts.store;
    this.send = opts.send ?? fetchSender;
    this.secret = opts.signingSecret;
    this.backoffMs = opts.backoffMs ?? defaultBackoff;
  }

  /** HMAC-SHA256 over the exact payload bytes, hex-encoded. */
  sign(payload: Buffer): string {
    return createHmac("sha256", this.secret).update(payload).digest("hex");
  }

  /** Verify a signature in constant time (exposed for subscribers/tests). */
  verify(payload: Buffer, signature: string): boolean {
    const expected = this.sign(payload);
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(signature, "utf8");
    return a.length === b.length && timingSafeEqual(a, b);
  }

  /**
   * Sign and persist a new delivery. The signature is computed once, over the
   * original bytes, and stored alongside them so every (re)send is identical.
   */
  async enqueue(
    input: Omit<NewDelivery, "signature"> & { signature?: string },
  ): Promise<WebhookDelivery> {
    const signature = input.signature ?? this.sign(input.payload);
    return this.store.createDelivery({ ...input, signature });
  }

  private buildHeaders(d: WebhookDelivery): Record<string, string> {
    return {
      "content-type": "application/json",
      [SIGNATURE_HEADER]: d.signature,
      "x-predictify-event-id": d.eventId,
      "x-predictify-event-type": d.eventType,
      ...(d.headers ?? {}),
    };
  }

  /**
   * Attempt a single delivery. On success marks the row delivered. On failure
   * increments the attempt counter; if that was the last allowed attempt the
   * delivery is dead-lettered (exactly once via `store.moveToDlq`). Returns the
   * resulting status.
   */
  async attemptDelivery(
    deliveryId: string,
  ): Promise<"delivered" | "retry" | "dead-lettered" | "gone"> {
    const delivery = await this.store.getDelivery(deliveryId);
    if (!delivery) return "gone";
    if (delivery.status === "delivered") return "delivered";

    const attempt = delivery.attempts + 1;
    let failure: string | null = null;

    try {
      const { status } = await this.send({
        url: delivery.targetUrl,
        body: delivery.payload,
        headers: this.buildHeaders(delivery),
      });
      if (status < 200 || status >= 300) {
        failure = `non-2xx response: ${status}`;
      }
    } catch (err) {
      failure = err instanceof Error ? err.message : String(err);
    }

    if (failure === null) {
      await this.store.updateDelivery(deliveryId, {
        status: "delivered",
        attempts: attempt,
        lastError: null,
        nextAttemptAt: null,
      });
      logger.info({ deliveryId, attempt }, "webhook_delivered");
      return "delivered";
    }

    // Record the failed attempt first so the attempt counter is durable even if
    // the process dies before the DLQ move.
    await this.store.updateDelivery(deliveryId, {
      status: "failed",
      attempts: attempt,
      lastError: failure,
      nextAttemptAt: new Date(Date.now() + this.backoffMs(attempt)),
    });

    if (attempt >= delivery.maxAttempts) {
      const dlqRow = await this.store.moveToDlq(deliveryId, failure);
      // moveToDlq returns null if the row was already dead-lettered → no-op,
      // preserving the "exactly once" guarantee under concurrent workers.
      if (dlqRow) {
        logger.warn(
          { deliveryId, dlqId: dlqRow.id, attempts: attempt, lastError: failure },
          "webhook_dead_lettered",
        );
      }
      return "dead-lettered";
    }

    logger.info({ deliveryId, attempt, lastError: failure }, "webhook_retry_scheduled");
    return "retry";
  }

  /**
   * Replay a dead-lettered delivery: create a fresh live delivery with the
   * attempt counter reset to zero, reusing the stored payload bytes and
   * signature so the subscriber receives a byte-identical, validly-signed
   * request. The DLQ row is marked replayed (idempotency). Returns the new live
   * delivery, or null if the row was already replayed.
   */
  async replayFromDlq(row: DlqRow): Promise<WebhookDelivery | null> {
    const fresh = await this.store.createDelivery({
      eventId: row.eventId,
      eventType: row.eventType,
      targetUrl: row.targetUrl,
      payload: row.payload, // original signed bytes, untouched
      signature: row.signature, // original signature, untouched
      headers: row.headers,
      maxAttempts: row.maxAttempts,
    });

    const ok = await this.store.markReplayed(row.id, fresh.id);
    if (!ok) {
      // Lost the race / already replayed: roll back the fresh row so we don't
      // leak a duplicate delivery.
      await this.store.updateDelivery(fresh.id, { status: "failed" });
      return null;
    }
    logger.info({ dlqId: row.id, newDeliveryId: fresh.id }, "webhook_replayed");
    return fresh;
  }
}
