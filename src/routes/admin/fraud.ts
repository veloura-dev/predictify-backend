/**
 * Admin fraud review endpoint.
 *
 *   GET  /api/admin/fraud/flags?status=open&limit=50
 *   POST /api/admin/fraud/scan                        (manual trigger)
 *
 * Both endpoints:
 *   • require an admin JWT (Bearer token, role: "admin")
 *   • validate input at the boundary with Zod
 *   • return the project's standard error envelope on failure
 *   • echo the request id so the client can correlate logs
 */

import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { requireAdmin } from "../../middleware/requireAdmin";
import { REQUEST_ID_HEADER } from "../../lib/http";
import { getRequestId } from "../../lib/requestContext";
import {
  DrizzleFraudRepo,
  type FraudRepo,
  listFraudFlags,
  runFraudScan,
} from "../../services/fraudService";

const listQuerySchema = z.object({
  status: z.enum(["open", "dismissed", "confirmed"]).optional(),
  limit: z
    .string()
    .regex(/^\d+$/u, { message: "limit must be a positive integer" })
    .transform((v) => parseInt(v, 10))
    .refine((n) => n >= 1 && n <= 200, {
      message: "limit must be between 1 and 200",
    })
    .optional(),
});

const scanBodySchema = z
  .object({
    lookbackMs: z.number().int().positive().max(7 * 24 * 60 * 60 * 1000).optional(),
    maxPredictions: z.number().int().positive().max(100_000).optional(),
  })
  .strict();

export interface AdminFraudRouterOptions {
  /** Inject a fake repo in tests. */
  repo?: FraudRepo;
  /** Requests per minute per admin token. Default: 60 */
  rateLimitPerMinute?: number;
}

function requestIdOf(req: { id?: unknown }): string {
  return (
    getRequestId() ??
    (typeof req.id === "string" ? req.id : "") ??
    ""
  );
}

export function createAdminFraudRouter(
  opts: AdminFraudRouterOptions = {},
): Router {
  const router = Router();
  const repo = opts.repo ?? new DrizzleFraudRepo();
  const limit = opts.rateLimitPerMinute ?? 60;

  router.use(
    rateLimit({
      windowMs: 60_000,
      limit,
      keyGenerator: (req) =>
        (req.headers.authorization as string | undefined) ??
        req.ip ??
        "unknown",
      standardHeaders: "draft-6",
      legacyHeaders: false,
      message: { error: { code: "rate_limit_exceeded" } },
    }),
  );

  router.use(requireAdmin);

  // ── GET /flags ────────────────────────────────────────────────────────────
  router.get("/flags", async (req, res, next) => {
    try {
      const requestId = requestIdOf({ id: (req as { id?: unknown }).id });
      const parsed = listQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.setHeader(REQUEST_ID_HEADER, requestId);
        res.status(400).json({
          error: {
            code: "validation_error",
            message:
              parsed.error.issues[0]?.message ?? "invalid query parameters",
            details: parsed.error.issues,
            requestId,
          },
        });
        return;
      }
      const rows = await listFraudFlags(parsed.data, repo);
      res.setHeader(REQUEST_ID_HEADER, requestId);
      res.json({ data: rows });
    } catch (e) {
      next(e);
    }
  });

  // ── POST /scan ────────────────────────────────────────────────────────────
  router.post("/scan", async (req, res, next) => {
    try {
      const requestId = requestIdOf({ id: (req as { id?: unknown }).id });
      const body = req.body ?? {};
      const parsed = scanBodySchema.safeParse(body);
      if (!parsed.success) {
        res.setHeader(REQUEST_ID_HEADER, requestId);
        res.status(400).json({
          error: {
            code: "validation_error",
            message:
              parsed.error.issues[0]?.message ?? "invalid request body",
            details: parsed.error.issues,
            requestId,
          },
        });
        return;
      }
      const result = await runFraudScan(repo, {
        ...parsed.data,
        correlationId: requestId,
      });
      res.setHeader(REQUEST_ID_HEADER, requestId);
      res.json({ data: result });
    } catch (e) {
      next(e);
    }
  });

  return router;
}

export const adminFraudRouter = createAdminFraudRouter();
