import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { logger } from "../config/logger";
import { AppError } from "../errors";

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: { code: "validation_error", details: err.issues },
    });
    return;
  }

  if (err instanceof AppError) {
    res.status(err.status).json({
      error: { code: err.code },
    });
    return;
  }

  const errObj = err as { status?: number; code?: string };
  logger.error({ err, path: req.path, method: req.method }, "request_failed");
  const status = errObj.status ?? 500;
  const code = errObj.code ?? (status === 500 ? "internal_error" : "request_failed");
  res.status(status).json({ error: { code } });
}
