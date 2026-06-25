import type { NextFunction, Request, Response } from "express";
import { logger } from "../config/logger";

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  logger.error({ err, path: req.path, method: req.method }, "request_failed");
  const status = (err as { status?: number }).status ?? 500;
  const code = (err as { code?: string }).code ?? (status === 500 ? "internal_error" : "request_failed");
  res.status(status).json({
    error: { code },
  });
}
