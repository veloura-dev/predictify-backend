import { Router } from "express";
import { listMarkets, getMarketById, updateMarket, VersionConflictError } from "../services/marketService";
import { searchMarkets } from "../repositories/marketRepository";
import { requireAdmin, AuthenticatedRequest } from "../middleware/auth";
import { rateLimitAnon } from "../middleware/rateLimitAnon";
import { z } from "zod";
import { logger } from "../config/logger";

export const marketsRouter = Router();

marketsRouter.use(rateLimitAnon);

const patchMarketSchema = z.object({
  question: z.string().optional(),
  metadata: z.any().optional(),
  expectedVersion: z.number().int().nonnegative(),
}).strict();

marketsRouter.get("/search", async (req, res, next) => {
  const reqId = String((req as any).id ?? "anon");
  try {
    const q = req.query.q as string;
    if (typeof q !== "string" || !q.trim()) {
      logger.warn({ reqId, correlationId: reqId, query: req.query }, "markets_search_validation_failed");
      return res.status(400).json({
        error: {
          code: "validation_error",
          message: "Search query parameter 'q' is required",
          correlationId: reqId,
          requestId: reqId,
        },
      });
    }

    const limit = parseInt(req.query.limit as string) || 20;
    const offset = parseInt(req.query.offset as string) || (parseInt(req.query.page as string) > 1 ? (parseInt(req.query.page as string) - 1) * limit : 0);
    const page = parseInt(req.query.page as string) || Math.floor(offset / limit) + 1;

    logger.info({ reqId, correlationId: reqId, query: q, limit, offset }, "markets_search_executed");

    const result = await searchMarkets({ query: q, limit, offset });

    return res.status(200).json({
      data: result.data,
      total: result.total,
      limit,
      offset,
      page,
      fallback: result.fallback,
      pagination: {
        limit,
        offset,
        page,
        total: result.total,
        fallback: result.fallback,
      },
      meta: {
        limit,
        offset,
        page,
        total: result.total,
        fallback: result.fallback,
      },
    });
  } catch (err) {
    logger.error({ reqId, correlationId: reqId, err }, "markets_search_failed");
    return next(err);
  }
});

marketsRouter.get("/", async (req, res, next) => {
  try {
    if (req.query.limit !== undefined && (isNaN(Number(req.query.limit)) || Number(req.query.limit) > 100)) {
      return res.status(400).json({ error: { code: "invalid_query" } });
    }
    return res.json({ data: await listMarkets() });
  } catch (e) { return next(e); }
});

marketsRouter.get("/:id", async (req, res, next) => {
  try {
    const market = await getMarketById(req.params.id as string);
    if (!market) {
      return res.status(404).json({ error: { code: "not_found" } });
    }
    return res.json({ data: market });
  } catch (e) { return next(e); }
});

marketsRouter.patch("/:id", requireAdmin, async (req: AuthenticatedRequest, res, next) => {
  try {
    const parsed = patchMarketSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: {
          code: "validation_error",
          details: parsed.error.issues,
        },
      });
    }

    const { question, metadata, expectedVersion } = parsed.data;
    const adminAddress = req.user!.stellarAddress;

    const patch: { question?: string; metadata?: any } = {};
    if (question !== undefined) patch.question = question;
    if (metadata !== undefined) patch.metadata = metadata;

    const updated = await updateMarket(req.params.id as string, patch, expectedVersion, adminAddress);
    return res.json({ data: updated });
  } catch (e) {
    if (e instanceof VersionConflictError) {
      return res.status(409).json({ error: { code: "version_conflict" } });
    }
    if ((e as any).status === 404) {
      return res.status(404).json({ error: { code: "not_found" } });
    }
    return next(e);
  }
});
