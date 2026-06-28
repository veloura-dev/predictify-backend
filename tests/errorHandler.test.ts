process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
process.env.JWT_SECRET = "a".repeat(32);
process.env.SOROBAN_RPC_URL = "https://rpc.testnet.stellar.org";
process.env.HORIZON_URL = "https://horizon.testnet.stellar.org";
process.env.PREDICTIFY_CONTRACT_ID = "CABC...";

import request from "supertest";
import { ZodError, z } from "zod";
import express from "express";
import { AppError, ErrorCodes } from "../src/errors";
import { RouteError } from "../src/errors/RouteError";

describe("AppError", () => {
  it("creates an error with code, message, status", () => {
    const err = new AppError("my_code", "my message", 400);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("my_code");
    expect(err.message).toBe("my message");
    expect(err.status).toBe(400);
    expect(err.details).toBeUndefined();
  });

  it("creates an error with details", () => {
    const err = new AppError("my_code", "my message", 422, { field: "name" });
    expect(err.details).toEqual({ field: "name" });
  });

  it("defaults to 500", () => {
    const err = new AppError("my_code", "msg");
    expect(err.status).toBe(500);
  });

  describe("static factories", () => {
    it("notFound creates 404", () => {
      const err = AppError.notFound("X not found");
      expect(err.code).toBe(ErrorCodes.NOT_FOUND);
      expect(err.status).toBe(404);
      expect(err.message).toBe("X not found");
    });

    it("internal creates 500", () => {
      const err = AppError.internal("Boom");
      expect(err.code).toBe(ErrorCodes.INTERNAL_ERROR);
      expect(err.status).toBe(500);
      expect(err.message).toBe("Boom");
    });

    it("validation creates 400", () => {
      const err = AppError.validation({ fields: ["email"] });
      expect(err.code).toBe(ErrorCodes.VALIDATION_ERROR);
      expect(err.status).toBe(400);
      expect(err.details).toEqual({ fields: ["email"] });
    });
  });
});

describe("GET /api/markets/:id", () => {
  it("returns 404 with standard envelope for unknown market", async () => {
    const { createApp } = await import("../src/index");
    const res = await request(createApp()).get("/api/markets/nonexistent");
    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe("not_found");
    expect(res.body.error.message).toBe("Market not found");
    expect(res.body.error.requestId).toEqual(expect.any(String));
  });
});

describe("errorHandler", () => {
  function createAppWithError(err: unknown): express.Express {
    const app = express();
    app.use(express.json());
    app.get("/error", () => { throw err; });
    const { errorHandler } = require("../src/middleware/errorHandler");
    app.use(errorHandler);
    return app;
  }

  it("handles AppError with correct envelope", async () => {
    const app = createAppWithError(new AppError("custom_code", "custom msg", 418));
    const res = await request(app).get("/error");
    expect(res.status).toBe(418);
    expect(res.body.error.code).toBe("custom_code");
    expect(res.body.error.message).toBe("custom msg");
    expect(res.body.error.requestId).toEqual(expect.any(String));
  });

  it("handles ZodError with validation envelope", async () => {
    const schema = z.object({ name: z.string().min(1) });
    let zodErr: ZodError | null = null;
    try { schema.parse({ name: "" }); } catch (e) { zodErr = e as ZodError; }

    const app = createAppWithError(zodErr!);
    const res = await request(app).get("/error");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    expect(res.body.error.message).toBe("Validation failed");
    expect(res.body.error.details).toBeInstanceOf(Array);
    expect(res.body.error.requestId).toEqual(expect.any(String));
  });

  it("handles unknown error with 500 envelope", async () => {
    const app = createAppWithError(new Error("unexpected"));
    const res = await request(app).get("/error");
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    expect(res.body.error.message).toBe("Internal error");
    expect(res.body.error.requestId).toEqual(expect.any(String));
  });

  it("does not leak stack traces", async () => {
    const app = createAppWithError(new Error("hidden"));
    const res = await request(app).get("/error");
    expect(res.body.error.stack).toBeUndefined();
    expect(res.text).not.toContain("Error: hidden");
  });

  // ─── RouteError tests (new discriminated union) ─────────────────────

  describe("RouteError handling", () => {
    it("handles NotFound RouteError with 404", async () => {
      const error: RouteError = { kind: "NotFound", message: "User not found", resource: "User" };
      const app = createAppWithError(error);
      const res = await request(app).get("/error");
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NotFound");
      expect(res.body.error.message).toBe("User not found");
      expect(res.body.error.correlationId).toEqual(expect.any(String));
    });

    it("handles Unauthorized RouteError with 401", async () => {
      const error: RouteError = { kind: "Unauthorized", message: "Invalid token" };
      const app = createAppWithError(error);
      const res = await request(app).get("/error");
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("Unauthorized");
      expect(res.body.error.message).toBe("Invalid token");
      expect(res.body.error.correlationId).toEqual(expect.any(String));
    });

    it("handles Forbidden RouteError with 403", async () => {
      const error: RouteError = {
        kind: "Forbidden",
        message: "Insufficient permissions",
        reason: "admin role required",
      };
      const app = createAppWithError(error);
      const res = await request(app).get("/error");
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("Forbidden");
      expect(res.body.error.message).toBe("Insufficient permissions");
      expect(res.body.error.correlationId).toEqual(expect.any(String));
    });

    it("handles ValidationError RouteError with 422 and fields", async () => {
      const error: RouteError = {
        kind: "ValidationError",
        message: "Validation failed",
        fields: { email: ["invalid format"], password: ["too short"] },
      };
      const app = createAppWithError(error);
      const res = await request(app).get("/error");
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("ValidationError");
      expect(res.body.error.message).toBe("Validation failed");
      expect(res.body.error.fields).toEqual({
        email: ["invalid format"],
        password: ["too short"],
      });
      expect(res.body.error.correlationId).toEqual(expect.any(String));
    });

    it("handles Conflict RouteError with 409", async () => {
      const error: RouteError = {
        kind: "Conflict",
        message: "Resource already exists",
        resource: "prediction",
      };
      const app = createAppWithError(error);
      const res = await request(app).get("/error");
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("Conflict");
      expect(res.body.error.message).toBe("Resource already exists");
      expect(res.body.error.correlationId).toEqual(expect.any(String));
    });

    it("handles BadRequest RouteError with 400", async () => {
      const error: RouteError = {
        kind: "BadRequest",
        message: "Bad request",
        detail: "Missing required field: id",
      };
      const app = createAppWithError(error);
      const res = await request(app).get("/error");
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("BadRequest");
      expect(res.body.error.message).toBe("Bad request");
      expect(res.body.error.correlationId).toEqual(expect.any(String));
    });

    it("handles InternalError RouteError with 500 and hides cause", async () => {
      const cause = new Error("Database connection failed");
      const error: RouteError = { kind: "InternalError", message: "Internal error", cause };
      const app = createAppWithError(error);
      const res = await request(app).get("/error");
      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe("InternalError");
      // Message should be generic, never leak internal details
      expect(res.body.error.message).toBe("An unexpected error occurred");
      expect(res.body.error.correlationId).toEqual(expect.any(String));
      // Never include cause in response
      expect(res.text).not.toContain("Database connection failed");
    });

    it("echoes correlationId from x-correlation-id header", async () => {
      const error: RouteError = { kind: "NotFound", message: "Not found" };
      const app = createAppWithError(error);
      const correlationId = "custom-correlation-id-12345";
      const res = await request(app)
        .get("/error")
        .set("x-correlation-id", correlationId);
      expect(res.status).toBe(404);
      expect(res.body.error.correlationId).toBe(correlationId);
    });

    it("generates correlationId when x-correlation-id header is absent", async () => {
      const error: RouteError = { kind: "NotFound", message: "Not found" };
      const app = createAppWithError(error);
      const res = await request(app).get("/error");
      expect(res.status).toBe(404);
      expect(res.body.error.correlationId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
    });

    it("does not leak RouteError cause details to client for InternalError", async () => {
      const cause = new Error("sensitive database error");
      const error: RouteError = { kind: "InternalError", message: "internal error", cause };
      const app = createAppWithError(error);
      const res = await request(app).get("/error");
      expect(res.body).not.toContain("sensitive database error");
      expect(res.text).not.toContain("sensitive database error");
    });
  });
});
