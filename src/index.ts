import express from "express";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { env } from "./config/env";
import { logger } from "./config/logger";
import { healthRouter } from "./routes/health";
import { marketsRouter } from "./routes/markets";
import { leaderboardRouter } from "./routes/leaderboard";
import { reconciliationRouter } from "./routes/reconciliation";
import { errorHandler } from "./middleware/errorHandler";
import { initializeScheduler, stopScheduler } from "./services/scheduler";

export function createApp(): express.Express {
  const app = express();
  app.use(helmet());
  app.use(express.json({ limit: "256kb" }));
  app.use(pinoHttp({ logger }));

  app.use("/health", healthRouter);
  app.use("/api/markets", marketsRouter);
  app.use("/api/leaderboard", leaderboardRouter);
  app.use("/api/reconciliation", reconciliationRouter);

  app.use(errorHandler);
  return app;
}

if (require.main === module) {
  const app = createApp();
  
  // Initialize scheduled tasks
  initializeScheduler();
  
  app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, "predictify-backend listening");
  });
  
  // Graceful shutdown
  process.on("SIGTERM", () => {
    logger.info("SIGTERM received, shutting down gracefully");
    stopScheduler();
    process.exit(0);
  });
  
  process.on("SIGINT", () => {
    logger.info("SIGINT received, shutting down gracefully");
    stopScheduler();
    process.exit(0);
  });
}
