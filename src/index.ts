import express from "express";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { env } from "./config/env";
import { logger } from "./config/logger";
import { metricsMiddleware } from "./metrics/httpMetrics";
import { idempotency } from "./middleware/idempotency";
import { healthRouter } from "./routes/health";
import { authRouter } from "./routes/auth";
import { marketsRouter } from "./routes/markets";
import { usersRouter } from "./routes/users";
import { predictionsRouter } from "./routes/predictions";
import { leaderboardRouter } from "./routes/leaderboard";
import { disputesRouter } from "./routes/disputes";
import { marketEventsRouter } from "./routes/marketEvents";
import { adminUsersRouter } from "./routes/adminUsers";
import { reconciliationRouter } from "./routes/reconciliation";
import { createDocsRouter } from "./routes/docs";
import { getOpenApiSpec } from "./openapi/builder";
import { errorHandler } from "./middleware/errorHandler";
import { connectWithRetry, closeDb } from "./db/client";
import { stopScheduler } from "./services/scheduler";

const docsEnabled =
  env.NODE_ENV !== "production" || process.env.ENABLE_DOCS === "true";

export function createApp(): express.Express {
  const app = express();

  // ── OpenAPI JSON spec (always available) ──────────────────────────────
  app.get("/openapi.json", (_req, res) => {
    res.json(getOpenApiSpec());
  });

  // ── Swagger UI (non-production or ENABLE_DOCS=true) ───────────────────
  // Must be mounted BEFORE the global helmet() so /docs receives its own
  // relaxed Content-Security-Policy. See docs/security.md.
  if (docsEnabled) {
    app.use("/docs", createDocsRouter());
  }

  // ── Global strict CSP ─────────────────────────────────────────────────
  app.use(helmet());
  app.use(express.json({ limit: "256kb" }));
  app.use(pinoHttp({ logger }));
  app.use(metricsMiddleware);

  app.use("/health", healthRouter);

  // Idempotency guard for all state-mutating routes under /api.
  const mutationMethods = ["POST", "PATCH"] as const;
  app.use("/api", (req, res, next) =>
    mutationMethods.includes(req.method as (typeof mutationMethods)[number])
      ? idempotency(req, res, next)
      : next(),
  );

  app.use("/api/auth", authRouter);
  app.use("/api/markets", marketsRouter);
  // Disputes are nested under markets: POST /api/markets/:id/disputes
  app.use("/api/markets/:id", disputesRouter);
  app.use("/api/markets", marketEventsRouter);
  app.use("/api/users", usersRouter);
  app.use("/api/predictions", predictionsRouter);
  app.use("/api/leaderboard", leaderboardRouter);
  app.use("/api/admin/users", adminUsersRouter);
  app.use("/api/reconciliation", reconciliationRouter);

  app.use(errorHandler);
  return app;
}

if (require.main === module) {
  const app = createApp();

  connectWithRetry()
    .then(() => {
      app.listen(env.PORT, () => {
        logger.info({ port: env.PORT, env: env.NODE_ENV }, "predictify-backend listening");
        if (docsEnabled) {
          logger.info(`Swagger UI available at http://localhost:${env.PORT}/docs`);
        }
      });
    })
    .catch((err) => {
      logger.fatal({ err }, "Failed to start server");
      process.exit(1);
    });

  process.on("SIGTERM", async () => {
    logger.info("SIGTERM received, shutting down");
    const forceExit = setTimeout(() => {
      logger.warn("Forced exit after shutdown timeout");
      process.exit(1);
    }, 5000).unref();

    stopScheduler();
    await closeDb();
    clearTimeout(forceExit);
    process.exit(0);
  });

  process.on("SIGINT", () => {
    logger.info("SIGINT received, shutting down gracefully");
    stopScheduler();
    process.exit(0);
  });
}
