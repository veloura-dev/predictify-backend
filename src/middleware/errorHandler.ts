import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { logger } from "../config/logger";
import { AppError, ErrorCodes } from "../errors";

function getRequestId(req: Request): string {
  const id = (req as { id?: unknown }).id;
  if (id == null) return "";
  return String(id);
}

/*
 * Status → error code mapping:
 *   ZodError        → 400  validation_error  (details array surfaces field paths)
 *   err.status=400  → 400  request_failed    (generic bad request)
 *   err.status=404  → 404  not_found
 *   err.status=409  → 409  conflict
 *   err.status=422  → 422  unprocessable
 *   other 4xx       → 4xx  request_failed
 *   5xx / unknown   → 500  internal_error    (internals never leaked)
 */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  logger.error({ err, path: req.path, method: req.method }, "request_failed");
  const status = (err as { status?: number }).status ?? 500;
  const code = (err as { code?: string }).code ?? (status === 500 ? "internal_error" : "request_failed");
  res.status(status).json({
    error: { code },
  });
}
