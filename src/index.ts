import express from "express";

import pinoHttp from "pino-http";
import { v4 as uuidv4 } from "uuid";
import { env } from "./config/env";
import { logger } from "./config/logger";
import { connectWithRetry, closeDb } from "./db/client";
import { REQUEST_ID_HEADER } from "./lib/http";
import { requestContextStorage } from "./lib/requestContext";
import { errorHandler } from "./middleware/errorHandler";
import { idempotency } from "./middleware/idempotency";
import { metricsMiddleware } from "./metrics/httpMetrics";
import { register } from "./metrics/registry";
import { authRouter } from "./routes/auth";
import { createDocsRouter } from "./routes/docs";
import { healthRouter } from "./routes/health";
import { leaderboardRouter } from "./routes/leaderboard";
import { marketsRouter } from "./routes/markets";
import { notificationsRouter } from "./routes/notifications";
import { socialRouter } from "./routes/social";
import { usersRouter } from "./routes/users";
import { stopScheduler } from "./services/scheduler";
import { adminAuditRouter } from "./routes/admin/audit";

const docsEnabled = env.NODE_ENV !== "production" || process.env.ENABLE_DOCS === "true";

const REQUEST_ID_MAX_LENGTH = 64;
const docsEnabled =
  env.NODE_ENV !== "production" || process.env.ENABLE_DOCS === "true";

function sanitizeRequestId(raw: string): string | undefined {
  const sanitized = raw
    .slice(0, REQUEST_ID_MAX_LENGTH)
    .replace(/[^A-Za-z0-9\-_.]/g, "");
  return sanitized.length > 0 ? sanitized : undefined;
}

export function createApp(): express.Express {
  const app = express();

  if (env.TRUST_PROXY) {
    app.set("trust proxy", true);
  }

  if (docsEnabled) {
    app.use("/docs", createDocsRouter());
  }

  app.use(helmet());
  app.use(express.json({ limit: "256kb" }));

  app.use(
    pinoHttp({
      logger,
      genReqId(req) {
        const inbound = req.headers[REQUEST_ID_HEADER];
        const raw = Array.isArray(inbound) ? inbound[0] : inbound;
        return (raw && sanitizeRequestId(raw)) ?? uuidv4();
      },
      customProps(req) {
        return { reqId: (req as { id?: string }).id };
      },
    }),
  );

  app.use(
    (
      req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      const requestId = String(req.id);
      res.setHeader(REQUEST_ID_HEADER, requestId);
      requestContextStorage.run({ requestId }, next);
    },
  );

  app.use(metricsMiddleware);
  app.use("/health", healthRouter);

  const mutationMethods = ["POST", "PATCH"] as const;
  app.use("/api", (req, res, next) =>
    mutationMethods.includes(req.method as (typeof mutationMethods)[number])
      ? idempotency(req, res, next)
      : next(),
  );

  app.use("/api/auth", authRouter);
  app.use("/api/markets", marketsRouter);
  app.use("/api/leaderboard", leaderboardRouter);
  app.use("/api/notifications", notificationsRouter);
  app.use("/api/users", socialRouter);
  app.use("/api/users", usersRouter);
  app.use("/api/admin/audit", adminAuditRouter);

  app.get("/metrics", async (req, res) => {
    const metricsAuthToken = process.env.METRICS_AUTH_TOKEN;
    if (
      metricsAuthToken &&
      req.headers.authorization !== `Bearer ${metricsAuthToken}`
    ) {
      res.status(401).send("Unauthorized");
      return;
    }

    res.set("Content-Type", register.contentType);
    res.send(await register.metrics());
  });

  app.use(errorHandler);
  return app;
}

if (require.main === module) {
  const app = createApp();

  connectWithRetry()
    .then(() => {
      app.listen(env.PORT, () => {
        logger.info(
          { port: env.PORT, env: env.NODE_ENV },
          "predictify-backend listening",
        );
        if (docsEnabled) {
          logger.info(
            `Swagger UI available at http://localhost:${env.PORT}/docs`,
          );
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
