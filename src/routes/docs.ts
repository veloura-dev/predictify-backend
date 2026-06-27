import { Router } from "express";
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";
import { getOpenApiSpec } from "../openapi/builder";

/**
 * Builds the /docs (Swagger UI) router.
 *
 * A scoped helmet middleware is applied only to this router so that
 * Swagger UI's inline scripts load without CSP violations, while the
 * rest of the application retains the strict global CSP.
 *
 * See docs/security.md for the rationale behind this exception.
 *
 * Mount this router only when NODE_ENV !== 'production' or ENABLE_DOCS=true.
 */
export function createDocsRouter(): Router {
  const router = Router();

  router.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "data:", "https://validator.swagger.io"],
          connectSrc: ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );

  router.use("/", swaggerUi.serve, swaggerUi.setup(getOpenApiSpec()));

  return router;
}
