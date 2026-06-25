import { Router } from "express";
import rateLimit from "express-rate-limit";
import { performReconciliation, getReconciliationReport, listReconciliationReports } from "../services/reconciliationService";

export const reconciliationRouter = Router();

// Rate limiter for reconciliation endpoint - max 1 request per hour
const reconciliationRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 1,
  message: { error: { code: "rate_limit_exceeded", message: "Reconciliation can only be triggered once per hour" } },
  standardHeaders: true,
  legacyHeaders: false,
});

// POST /api/reconciliation - Trigger manual reconciliation (rate limited)
reconciliationRouter.post("/", reconciliationRateLimiter, async (_req, res, next) => {
  try {
    const result = await performReconciliation();
    res.json({ data: result });
  } catch (e) {
    next(e);
  }
});

// GET /api/reconciliation - List recent reconciliation reports with pagination
reconciliationRouter.get("/", async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 100);
    const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);
    const reports = await listReconciliationReports(limit, offset);
    res.json({ data: reports, meta: { limit, offset } });
  } catch (e) {
    next(e);
  }
});

// GET /api/reconciliation/:reportId - Get specific reconciliation report
reconciliationRouter.get("/:reportId", async (req, res, next) => {
  try {
    const report = await getReconciliationReport(req.params.reportId);
    if (!report) {
      return res.status(404).json({ error: { code: "not_found" } });
    }
    res.json({ data: report });
  } catch (e) {
    next(e);
  }
});
