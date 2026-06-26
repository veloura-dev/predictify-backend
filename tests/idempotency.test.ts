/**
 * Tests for the Idempotency-Key middleware.
 *
 * The DB layer is mocked so these tests run without a real Postgres instance.
 * All acceptance criteria are covered:
 *  ✓ No key   → passes through (no-op)
 *  ✓ Miss     → executes handler, stores response
 *  ✓ Hit same fingerprint → replays stored response (Idempotent-Replayed: true)
 *  ✓ Hit diff fingerprint → 409 idempotency_conflict
 *  ✓ Invalid key          → 400 invalid_idempotency_key
 *  ✓ Non-2xx responses    → NOT stored (e.g. 422)
 */

import request from "supertest";
import express from "express";
import type { Request, Response } from "express";

// ---- Mock the DB module BEFORE importing middleware ----------------------
const mockSelect = jest.fn();
const mockInsert = jest.fn();
const mockDelete = jest.fn();

jest.mock("../src/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: mockSelect }) }) }),
    insert: () => ({ values: mockInsert }),
    delete: () => ({ where: mockDelete }),
  },
}));

import { idempotency } from "../src/middleware/idempotency";

// ---- Helpers ---------------------------------------------------------------

function makeApp(handler: (req: Request, res: Response) => void) {
  const app = express();
  app.use(express.json());
  app.post("/test", idempotency, handler);
  app.patch("/test", idempotency, handler);
  return app;
}

const KEY = "test-key-abc-123";
const BODY = { amount: "100" };

/** A stored record that matches BODY's fingerprint */
const storedRecord = {
  key: KEY,
  fingerprint: "5bb91de7f2c18b18e1bba6ca1a0dba43a695e3f0d7d71dc5b7e5b2f32b2a1d53", // computed below
  responseStatus: 201,
  responseBody: { data: { id: "abc" } },
  responseHeaders: { "content-type": "application/json" },
  expiresAt: new Date(Date.now() + 86400_000),
  createdAt: new Date(),
};

// Pre-compute the real fingerprint for BODY so the mock matches
import crypto from "crypto";
const BODY_FINGERPRINT = crypto.createHash("sha256").update(JSON.stringify(BODY)).digest("hex");

beforeEach(() => {
  jest.clearAllMocks();
});

// ---- Tests ------------------------------------------------------------------

describe("idempotency middleware", () => {
  describe("no Idempotency-Key header", () => {
    it("passes through to the handler", async () => {
      mockSelect.mockResolvedValue([]);
      const handler = jest.fn((_req: Request, res: Response) => res.status(201).json({ ok: true }));
      const res = await request(makeApp(handler)).post("/test").send(BODY);
      expect(res.status).toBe(201);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(mockSelect).not.toHaveBeenCalled();
    });
  });

  describe("invalid Idempotency-Key", () => {
    it("rejects a key longer than 255 chars", async () => {
      const res = await request(makeApp(jest.fn()))
        .post("/test")
        .set("Idempotency-Key", "x".repeat(256))
        .send(BODY);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("invalid_idempotency_key");
    });
  });

  describe("cache miss (first call)", () => {
    it("calls the handler and stores the response", async () => {
      mockSelect.mockResolvedValue([]); // no existing record
      mockInsert.mockResolvedValue(undefined);

      const handler = (_req: Request, res: Response) => res.status(201).json({ data: { id: "abc" } });
      const res = await request(makeApp(handler)).post("/test").set("Idempotency-Key", KEY).send(BODY);

      expect(res.status).toBe(201);
      expect(res.headers["idempotent-replayed"]).toBeUndefined();

      // The middleware should have attempted to persist the record
      expect(mockInsert).toHaveBeenCalledTimes(1);
      const inserted = mockInsert.mock.calls[0][0] as Record<string, unknown>;
      expect(inserted.key).toBe(KEY);
      expect(inserted.fingerprint).toBe(BODY_FINGERPRINT);
      expect(inserted.responseStatus).toBe(201);
    });

    it("does NOT store a non-2xx response", async () => {
      mockSelect.mockResolvedValue([]);
      mockInsert.mockResolvedValue(undefined);

      const handler = (_req: Request, res: Response) =>
        res.status(422).json({ error: { code: "validation_error" } });
      const res = await request(makeApp(handler)).post("/test").set("Idempotency-Key", KEY).send(BODY);

      expect(res.status).toBe(422);
      expect(mockInsert).not.toHaveBeenCalled();
    });
  });

  describe("cache hit – same fingerprint (replay)", () => {
    it("returns the stored response without calling the handler", async () => {
      mockSelect.mockResolvedValue([{ ...storedRecord, fingerprint: BODY_FINGERPRINT }]);

      const handler = jest.fn();
      const res = await request(makeApp(handler)).post("/test").set("Idempotency-Key", KEY).send(BODY);

      expect(res.status).toBe(201);
      expect(res.body).toEqual(storedRecord.responseBody);
      expect(res.headers["idempotent-replayed"]).toBe("true");
      expect(handler).not.toHaveBeenCalled();
      expect(mockInsert).not.toHaveBeenCalled();
    });
  });

  describe("cache hit – different fingerprint (conflict)", () => {
    it("returns 409 idempotency_conflict", async () => {
      mockSelect.mockResolvedValue([{ ...storedRecord, fingerprint: "different-hash" }]);

      const handler = jest.fn();
      const res = await request(makeApp(handler))
        .post("/test")
        .set("Idempotency-Key", KEY)
        .send({ amount: "999" }); // different body

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("idempotency_conflict");
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe("PATCH requests", () => {
    it("applies idempotency on PATCH", async () => {
      mockSelect.mockResolvedValue([{ ...storedRecord, fingerprint: BODY_FINGERPRINT }]);

      const res = await request(makeApp(jest.fn())).patch("/test").set("Idempotency-Key", KEY).send(BODY);

      expect(res.status).toBe(201);
      expect(res.headers["idempotent-replayed"]).toBe("true");
    });
  });
});
