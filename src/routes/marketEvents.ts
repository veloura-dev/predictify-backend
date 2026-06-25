import { Router, type Request, type Response } from "express";
import { createSSEPump } from "../services/marketEventsStream";
import { logger } from "../config/logger";

export const marketEventsRouter = Router();

function parseLastEventId(req: Request): number | null {
  const header = req.headers["last-event-id"];
  if (header) {
    const id = parseInt(Array.isArray(header) ? header[0] : header, 10);
    if (!isNaN(id) && id >= 0) return id;
  }
  return null;
}

function setSSEHeaders(res: Response): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
}

marketEventsRouter.get("/:id/events", (req: Request, res: Response) => {
  const marketId = req.params.id as string;

  if (!marketId) {
    res.status(400).json({ error: { code: "missing_market_id" } });
    return;
  }

  const lastEventId = parseLastEventId(req);

  setSSEHeaders(res);
  res.flushHeaders();

  res.write(": connected\n\n");

  const cleanup = createSSEPump(
    marketId,
    (chunk) => { res.write(chunk); },
    (chunk) => { res.write(chunk); },
    (err) => {
      logger.error({ err, marketId }, "SSE pump error");
      res.write(`event: error\ndata: ${JSON.stringify({ message: "internal error" })}\n\n`);
      cleanup();
      res.end();
    },
    lastEventId,
  );

  req.on("close", () => {
    cleanup();
  });
});
