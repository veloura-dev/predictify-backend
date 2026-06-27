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
import { errorHandler } from "./middleware/errorHandler";
import { connectWithRetry, closeDb } from "./db/client";
import { defaultRateLimiter } from "./middleware/rateLimit";

export function createApp(): express.Express {
  const app = express();

  app.use(helmet());
  app.use(express.json({ limit: "256kb" }));

  // ── pinoHttp ─────────────────────────────────────────────────────────────
  //
  // genReqId  - Honour an inbound X-Request-Id (sanitised); generate a UUID v4
  //             when absent or when the inbound value is empty after sanitising.
  //
  // customProps - Lift req.id and the fingerprint to the top level of every log
  //               line so they can be searched without drilling into nested objs.
  app.use(
    pinoHttp({
      logger,
      genReqId(req) {
        const inbound = req.headers[REQUEST_ID_HEADER];
        const raw = Array.isArray(inbound) ? inbound[0] : inbound;
        return (raw && sanitizeRequestId(raw)) ?? uuidv4();
      },
      customProps(req, res) {
        return {
          reqId: req.id,
          // fingerprint is set by fingerprintMiddleware which runs after this,
          // so it will be present on the response-completion log line (pino-http
          // reads customProps at log time, not at middleware registration time).
          fingerprint: (res as express.Response).locals["fingerprint"],
        };
      },
    }),
  );

  // ── AsyncLocalStorage + response-header middleware ────────────────────────
  //
  // Runs after pinoHttp so that req.id is already set.
  //
  // 1. Echoes the (possibly sanitised / generated) id back to the caller via
  //    the X-Request-Id response header, making correlation trivial for clients.
  //
  // 2. Wraps the remaining middleware chain inside an AsyncLocalStorage context
  //    so that any code further downstream — including async workers started
  //    from a request handler — can call getRequestId() without needing the
  //    id passed through every function argument.
  app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
    const requestId = req.id as string;

    // Echo back to client.
    res.setHeader(REQUEST_ID_HEADER, requestId);

    // Make available to all downstream code via AsyncLocalStorage.
    // fingerprint is added to the store by fingerprintMiddleware below.
    requestContextStorage.run({ requestId }, next);
  });

  // ── Fingerprint middleware ────────────────────────────────────────────────
  //
  // Runs inside the ALS context (getRequestId() is available) and after
  // express.json() (req.body is parsed).  Sets res.locals.fingerprint and
  // the X-Request-Fingerprint response header, then updates the ALS store.
  app.use(fingerprintMiddleware);

  // Propagate the computed fingerprint into the ALS store so that workers
  // and background code spawned after this point can read it via
  // getFingerprint() without needing it passed as a function argument.
  app.use((_req: express.Request, res: express.Response, next: express.NextFunction) => {
    const store = requestContextStorage.getStore();
    if (store) {
      store.fingerprint = res.locals["fingerprint"] as string | undefined;
    }
    next();
  });

  app.use("/health", healthRouter);

  // Idempotency guard for all state-mutating routes under /api.
  // Must be mounted before the routers it protects.

  app.use("/api", defaultRateLimiter);
  const mutationMethods = ["POST", "PATCH"] as const;
  app.use("/api", (req, res, next) =>
    mutationMethods.includes(req.method as (typeof mutationMethods)[number])
      ? idempotency(req, res, next)
      : next(),
  );


  app.use("/api/auth", authRouter);
  app.use("/api/markets", marketsRouter);
  app.use("/api/users", usersRouter);

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
