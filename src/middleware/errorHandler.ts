import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { logger } from "../config/logger";
import { AppError, ErrorCodes, isRouteError, HTTP_STATUS, ErrorEnvelope } from "../errors";
import { randomUUID } from "crypto";

function getRequestId(req: Request): string {
  const id = (req as { id?: unknown }).id;
  if (id == null) return "";
  return String(id);
}

/*
 * Error handling strategy:
 *
 * 1. RouteError (discriminated union)  → Translate via HTTP_STATUS map
 * 2. AppError (legacy)                  → Use embedded status and code
 * 3. ZodError (validation)              → 400 validation_error
 * 4. Other thrown errors                → 500 internal_error (never leak cause)
 *
 * All responses include a correlationId from x-correlation-id header or generated.
 * Internal error causes are logged but never sent to clients.
 */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  const correlationId = (req.headers["x-correlation-id"] as string) ?? randomUUID();

  // ─── RouteError (new structured union) ─────────────────────────────────
  if (isRouteError(err)) {
    const status = HTTP_STATUS[err.kind];

    // Log with cause details for InternalError (never sent to client)
    const logPayload = {
      correlationId,
      kind: err.kind,
      path: req.path,
      method: req.method,
      ...(err.kind === "InternalError" ? { cause: err.cause } : {}),
    };
    logger.error(logPayload, "route_error");

    // Build envelope, hiding internal details
    const envelope: ErrorEnvelope = {
      code: err.kind,
      message: err.kind === "InternalError" ? "An unexpected error occurred" : err.message,
      correlationId,
    };

    // Include validation fields if present
    if (err.kind === "ValidationError" && err.fields) {
      envelope.fields = err.fields;
    }

    res.status(status).json({ error: envelope });
    return;
  }

  // ─── AppError (legacy, for backward compatibility) ──────────────────────
  if (err instanceof AppError) {
    logger.error({ err, path: req.path, method: req.method }, "app_error");
    res.status(err.status).json({
      error: { code: err.code, correlationId },
    });
    return;
  }

  // ─── ZodError (validation from endpoints) ──────────────────────────────
  if (err instanceof ZodError) {
    logger.warn({ err, path: req.path, method: req.method }, "validation_error");
    res.status(400).json({
      error: { code: "validation_error", correlationId },
    });
    return;
  }

  // ─── Unknown error (wrapped as InternalError) ───────────────────────────
  logger.error({ err, path: req.path, method: req.method }, "unknown_error");
  res.status(500).json({
    error: {
      code: "internal_error",
      message: "An unexpected error occurred",
      correlationId,
    },
  });
}
