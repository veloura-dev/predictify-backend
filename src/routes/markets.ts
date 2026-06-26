import { Router } from "express";
import { z } from "zod";
import { listMarkets, getMarketById } from "../services/marketService";
import { AppError } from "../errors";

export const marketsRouter = Router();

const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
  offset: z.coerce.number().int().nonnegative().optional(),
});

marketsRouter.get("/", async (req, res, next) => {
  try {
    return res.json({ data: await listMarkets() });
  } catch (e) {
    return next(e);
  }
});

marketsRouter.get("/:id", async (req, res, next) => {
  try {
    const market = await getMarketById(req.params.id);
    if (!market) return res.status(404).json({ error: { code: "not_found" } });
    return res.json({ data: market });
  } catch (e) {
    return next(e);
  }
});
