import { Router } from "express";
import { listMarkets, getMarketById } from "../services/marketService";
import { disputesRouter } from "./disputes";

export const marketsRouter = Router();

marketsRouter.get("/", async (_req, res, next) => {
  try {
    res.json({ data: await listMarkets() });
  } catch (e) { return next(e); }
});

marketsRouter.get("/:id", async (req, res, next) => {
  try {
    const market = await getMarketById(req.params.id);
    if (!market) return res.status(404).json({ error: { code: "not_found" } });
    return res.json({ data: market });
  } catch (e) { return next(e); }
});

marketsRouter.use("/:id/disputes", disputesRouter);
