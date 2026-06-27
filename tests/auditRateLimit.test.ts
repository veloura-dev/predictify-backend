/**
 * Tests for audit-trail enrichment with rate-limit context.
 * Covers auditService and rateLimit middleware in isolation and together.
 */

import request from "supertest";
import express, { type Express, type Request, type Response } from "express";
import { createRateLimiter } from "../src/middleware/rateLimit";
import { createAuditLog } from "../src/services/auditService";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock("../src/db/client", () => ({
  db: {
    insert: jest.fn().mockReturnValue({
      values: jest.fn().mockResolvedValue(undefined),
    }),
  },
}));

jest.mock("../src/config/logger", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock("../src/db/schema", () => ({
  auditLogs: "audit_logs",
}));

import { db } from "../src/db/client";
import { logger } from "../src/config/logger";

const mockInsert = db.insert as jest.MockedFunction<typeof db.insert>;
const mockLoggerInfo = logger.info as jest.Mock;
const mockLoggerWarn = logger.warn as jest.Mock;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildApp(limiterOptions = {}): Express {
  const app = express();
  app.use(express.json());
  app.use(createRateLimiter(limiterOptions));

  app.get("/test", (req: Request, res: Response) => {
    res.json({ rateLimitContext: req.rateLimitContext, correlationId: req.correlationId });
  });

  return app;
}

// ---------------------------------------------------------------------------
// auditService tests
// ---------------------------------------------------------------------------

describe("auditService.createAuditLog", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInsert.mockReturnValue({ values: jest.fn().mockResolvedValue(undefined) } as any);
  });

  it("inserts an audit entry into the database", async () => {
    await createAuditLog({ action: "auth.login", ip: "1.2.3.4" });
    expect(mockInsert).toHaveBeenCalledWith("audit_logs");
  });

  it("logs at info level with correlationId", async () => {
    await createAuditLog({ action: "auth.login", ip: "1.2.3.4", correlationId: "test-corr-id" });
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({ correlationId: "test-corr-id", action: "auth.login" }),
      "audit_log_created",
    );
  });

  it("generates a correlationId if not provided", async () => {
    const corrId = await createAuditLog({ action: "auth.login", ip: "1.2.3.4" });
    expect(corrId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("returns the provided correlationId", async () => {
    const corrId = await createAuditLog({
      action: "auth.login",
      ip: "1.2.3.4",
      correlationId: "my-corr-id",
    });
    expect(corrId).toBe("my-corr-id");
  });

  it("includes rateLimitContext in the db entry when provided", async () => {
    const rateLimitContext = { limit: 100, remaining: 0, resetAt: "2025-01-01T00:00:00.000Z", blocked: true };
    const valuesMock = jest.fn().mockResolvedValue(undefined);
    mockInsert.mockReturnValue({ values: valuesMock } as any);

    await createAuditLog({ action: "rate_limit.blocked", ip: "1.2.3.4", rateLimitContext });

    expect(valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({ rateLimitContext }),
    );
  });

  it("stores null rateLimitContext when not provided", async () => {
    const valuesMock = jest.fn().mockResolvedValue(undefined);
    mockInsert.mockReturnValue({ values: valuesMock } as any);

    await createAuditLog({ action: "auth.login", ip: "1.2.3.4" });

    expect(valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({ rateLimitContext: null }),
    );
  });

  it("stores null walletAddress when not provided", async () => {
    const valuesMock = jest.fn().mockResolvedValue(undefined);
    mockInsert.mockReturnValue({ values: valuesMock } as any);

    await createAuditLog({ action: "auth.login", ip: "1.2.3.4" });

    expect(valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({ walletAddress: null }),
    );
  });

  it("does not throw if db insert fails — logs warn instead", async () => {
    mockInsert.mockReturnValue({
      values: jest.fn().mockRejectedValue(new Error("db down")),
    } as any);

    await expect(
      createAuditLog({ action: "auth.login", ip: "1.2.3.4" }),
    ).resolves.not.toThrow();

    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({ action: "auth.login" }),
      "audit_log_write_failed",
    );
  });
});

// ---------------------------------------------------------------------------
// rateLimit middleware tests
// ---------------------------------------------------------------------------

describe("rateLimit middleware", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInsert.mockReturnValue({ values: jest.fn().mockResolvedValue(undefined) } as any);
  });

  it("attaches rateLimitContext to req on allowed requests", async () => {
    const app = buildApp({ limit: 10, windowMs: 60_000 });
    const res = await request(app).get("/test");

    expect(res.status).toBe(200);
    expect(res.body.rateLimitContext).toBeDefined();
    expect(res.body.rateLimitContext.blocked).toBe(false);
  });

  it("attaches a correlationId to req", async () => {
    const app = buildApp({ limit: 10, windowMs: 60_000 });
    const res = await request(app).get("/test");

    expect(res.body.correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("returns 429 and correct error envelope when limit exceeded", async () => {
    const app = buildApp({ limit: 1, windowMs: 60_000 });

    await request(app).get("/test"); // consume the 1 allowed request
    const res = await request(app).get("/test"); // this one gets blocked

    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: { code: "rate_limit_exceeded" } });
  });

  it("fires audit log with blocked: true when request is blocked", async () => {
    const app = buildApp({ limit: 1, windowMs: 60_000 });

    await request(app).get("/test");
    await request(app).get("/test"); // blocked

    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        rateLimitContext: expect.objectContaining({ blocked: true }),
      }),
      "rate_limit_blocked",
    );
  });

  it("audit log entry includes action rate_limit.blocked", async () => {
    const app = buildApp({ limit: 1, windowMs: 60_000 });

    await request(app).get("/test");
    await request(app).get("/test"); // blocked

    expect(mockInsert).toHaveBeenCalledWith("audit_logs");
  });

  it("blocked response has remaining: 0 in rateLimitContext", async () => {
    const app = buildApp({ limit: 1, windowMs: 60_000 });

    await request(app).get("/test");
    await request(app).get("/test"); // blocked

    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.objectContaining({
        rateLimitContext: expect.objectContaining({ remaining: 0, blocked: true }),
      }),
      "rate_limit_blocked",
    );
  });

  it("does not fire audit log on allowed requests", async () => {
    const app = buildApp({ limit: 10, windowMs: 60_000 });
    await request(app).get("/test");

    // insert should not have been called for an allowed request
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("rateLimitContext.resetAt is a valid ISO-8601 string", async () => {
    const app = buildApp({ limit: 10, windowMs: 60_000 });
    const res = await request(app).get("/test");

    const resetAt = res.body.rateLimitContext?.resetAt;
    expect(resetAt).toBeDefined();
    expect(new Date(resetAt).toISOString()).toBe(resetAt);
  });
});
