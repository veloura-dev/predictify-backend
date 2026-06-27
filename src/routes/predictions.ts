/**
 * /api/predictions — sample protected resource.
 *
 * Demonstrates how to import and apply `requireAuth`.  Because the middleware
 * runs before every handler on this router, TypeScript knows `req.user` is
 * defined (non-optional) inside the callbacks.
 */

import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth";

export const predictionsRouter = Router();

// Apply requireAuth to every route on this router.
predictionsRouter.use(requireAuth);

/**
 * GET /api/predictions
 * Returns predictions belonging to the authenticated user.
 */
predictionsRouter.get("/", (req, res) => {
  // req.user is guaranteed to be defined here because requireAuth
  // would have returned 401 before reaching this handler.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  res.json({ data: [], user: (req as any).user });
});
