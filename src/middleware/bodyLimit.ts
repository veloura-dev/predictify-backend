import express, { type ErrorRequestHandler, type NextFunction, type Request, type RequestHandler, type Response } from "express";
import type { OptionsJson } from "body-parser";
import { AppError, ErrorCodes } from "../errors";

export const DEFAULT_BODY_LIMIT = "256kb";
export const WEBHOOK_BODY_LIMIT = "1mb";

export interface BodyLimitOptions {
  limit?: OptionsJson["limit"];
}

function normalizeLimit(limit?: OptionsJson["limit"]): OptionsJson["limit"] {
  return limit ?? DEFAULT_BODY_LIMIT;
}

function isPayloadTooLargeError(err: unknown): err is Error & {
  status?: number;
  type?: string;
  limit?: number | string;
  length?: number;
  expected?: number;
} {
  return (
    typeof err === "object" &&
    err !== null &&
    (("status" in err && (err as { status?: unknown }).status === 413) ||
      ("type" in err && (err as { type?: unknown }).type === "entity.too.large"))
  );
}

export function createBodyLimitMiddleware(options: BodyLimitOptions = {}): Array<RequestHandler | ErrorRequestHandler> {
  const parser = express.json({ limit: normalizeLimit(options.limit) });

  const payloadTooLargeHandler: ErrorRequestHandler = (
    err: unknown,
    _req: Request,
    _res: Response,
    next: NextFunction,
  ) => {
    if (!isPayloadTooLargeError(err)) {
      next(err);
      return;
    }

    next(
      new AppError(
        ErrorCodes.REQUEST_FAILED,
        "Request body too large",
        413,
        {
          limit: err.limit,
          length: err.length ?? err.expected,
        },
      ),
    );
  };

  return [parser, payloadTooLargeHandler];
}

export const defaultBodyLimitMiddleware = createBodyLimitMiddleware();
export const webhookBodyLimitMiddleware = createBodyLimitMiddleware({
  limit: WEBHOOK_BODY_LIMIT,
});
