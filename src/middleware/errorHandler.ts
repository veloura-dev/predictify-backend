import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { randomUUID } from "crypto";
import { logger } from "../config/logger";
import { AppError, ErrorCodes, isRouteError, HTTP_STATUS, ErrorEnvelope } from "../errors";
import { getRequestId } from "../lib/requestContext";

function requestIdFrom(req: Request, fallback: string): string {
  return getRequestId() ?? (typeof (req as { id?: unknown }).id === "string" ? (req as { id?: string }).id : undefined) ?? fallback;
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
) {
  const correlationId = (req.headers["x-correlation-id"] as string) ?? (typeof (req as { id?: unknown }).id === "string" ? (req as { id?: string }).id : undefined) ?? randomUUID();
  const reqId = requestIdFrom(req, correlationId);

  // 1. RouteError (discriminated union)
  if (isRouteError(err)) {
    const status = HTTP_STATUS[err.kind];
    const logPayload = {
      correlationId,
      requestId: reqId,
      kind: err.kind,
      path: req.path,
      method: req.method,
      ...(err.kind === "InternalError" ? { cause: err.cause } : {}),
    };
    logger.error(logPayload, "route_error");

    const envelope: ErrorEnvelope & { requestId?: string } = {
      code: err.kind,
      message: err.kind === "InternalError" ? "An unexpected error occurred" : err.message,
      correlationId,
      requestId: reqId,
    };
    if (err.kind === "ValidationError" && err.fields) {
      envelope.fields = err.fields;
    }
    res.status(status).json({ error: envelope });
    return;
  }

  // 2. AppError (legacy)
  if (err instanceof AppError) {
    logger.error({ err, path: req.path, method: req.method, requestId: reqId }, "app_error");
    res.status(err.status).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.details !== undefined ? { details: err.details } : {}),
        correlationId,
        requestId: reqId,
      },
    });
    return;
  }

  // 3. ZodError
  if (err instanceof ZodError) {
    logger.warn({ err, path: req.path, method: req.method, requestId: reqId }, "validation_error");
    res.status(400).json({
      error: {
        code: ErrorCodes.VALIDATION_ERROR,
        message: "Validation failed",
        details: err.issues,
        correlationId,
        requestId: reqId,
      },
    });
    return;
  }

  // 4. Unknown error
  logger.error({ err, path: req.path, method: req.method, requestId: reqId }, "unknown_error");
  res.status(500).json({
    error: {
      code: ErrorCodes.INTERNAL_ERROR,
      message: "Internal error",
      correlationId,
      requestId: reqId,
    },
  });
}
