// Add these imports at the top if missing
import crypto from 'crypto';

// Update your profile handler
export const getProfile = async (req: Request, res: Response) => {
  const profile = await userService.getProfile(req.params.addr); // Adjust based on your actual service call
  
  if (!profile) return res.status(404).send('Not Found');

  const etag = crypto.createHash('md5').update(JSON.stringify(profile)).digest('hex');
  
  res.set('ETag', etag);
  res.set('Cache-Control', 'public, max-age=0, must-revalidate');

  if (req.header('If-None-Match') === etag) {
    return res.status(304).end();
  }

  res.json(profile);
};/**
 * users.ts
 *
 * Public user-profile routes.
 *
 * Routes
 * ──────
 *   GET /api/users/:stellarAddress/profile
 *     Returns the public profile for a Stellar account address.
 *     The response contains the user's prediction history and aggregate
 *     totals. No authentication is required — all data exposed here is
 *     considered public information (it mirrors what is visible on-chain).
 *
 * Privacy
 * ───────
 *   - Only the Stellar address (already public on-chain) is returned.
 *   - No email, IP address, or other off-chain PII is exposed.
 *   - Internal database UUIDs are included so that clients can build
 *     links, but they carry no sensitive meaning.
 *
 * Error codes
 * ───────────
 *   404  not_found        — no user registered with that Stellar address
 *   400  validation_error — address fails basic format validation
 *   500  internal_error   — unexpected server error (via global handler)
 */

import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { getUserByAddress, getUserPredictions, getCurrentUserProfile } from "../services/userService";
import { requireAuthForbidden } from "../middleware/requireAuth";
import { AuthenticatedRequest } from "../middleware/auth";
import { logger } from "../config/logger";

export const usersRouter = Router();

// ── Validation ────────────────────────────────────────────────────────────

/**
 * GET /api/users/me
 * --------------------
 * Returns the authenticated user's own profile (no path parameter).
 *
 *   {
 *     "data": {
 *       "stellarAddress": "G…",
 *       "createdAt":      "2024-…Z",
 *       "totals": { "prediction_count": N, "claim_count": M }
 *     }
 *   }
 *
 * Authentication is enforced by `requireAuthForbidden` — the issue spec
 * (#132) requires **HTTP 403** for unauthenticated callers, which differs
 * from the standard `requireAuth` (HTTP 401).  Path order matters: this
 * route must be registered before `/:address/predictions` so Express does
 * not capture "me" as an address parameter.
 */
usersRouter.get("/me", requireAuthForbidden, async (req: AuthenticatedRequest, res, next) => {
  try {
    // requireAuthForbidden guarantees req.user is populated when next() is
    // called.  Use the existing AuthenticatedRequest type so we don't need
    // a global Request augmentation just for this one route.
    const userId = req.user!.id;
    const profile = await getCurrentUserProfile(userId);
    logger.info(
      { userId, stellarAddress: profile.stellarAddress, ...profile.totals },
      "user_me_profile_loaded",
    );
    return res.json({ data: profile });
  } catch (e) {
    // The global errorHandler shapes AppError instances into the standard
    // JSON envelope (e.g. AppError not_found → 404 not_found), so we simply
    // propagate.  Anything else is a 500 internal_error there.
    return next(e);
  }
});

usersRouter.get("/:address/predictions", async (req, res, next) => {
  try {
    const { address } = req.params;
    const { status, cursor, limit = "20" } = req.query;

// ── Route ─────────────────────────────────────────────────────────────────

/**
 * GET /api/users/:stellarAddress/profile
 *
 * Public endpoint — no authentication required.
 *
 * Returns the profile for the user identified by `stellarAddress`.
 *
 * Example response (200):
 * ```json
 * {
 *   "data": {
 *     "id": "3fa85f64-...",
 *     "stellarAddress": "GABC...XYZ",
 *     "joinedAt": "2024-01-15T10:30:00.000Z",
 *     "predictions": [
 *       {
 *         "id": "7c9e6679-...",
 *         "market": {
 *           "id": "market-contract-id",
 *           "question": "Will BTC exceed $100k by end of 2025?",
 *           "status": "resolved",
 *           "resolutionTime": "2025-12-31T23:59:59.000Z"
 *         },
 *         "outcome": "yes",
 *         "amount": "5000000",
 *         "createdAt": "2024-03-01T08:00:00.000Z"
 *       }
 *     ],
 *     "totals": {
 *       "totalPredictions": 1,
 *       "totalAmountStaked": "5000000",
 *       "wins": 1,
 *       "losses": 0
 *     }
 *   }
 * }
 * ```
 */
usersRouter.get(
  "/:stellarAddress/profile",
  async (req: Request, res: Response, next: NextFunction) => {
    const reqId = getRequestId();

    // ── 1. Input validation ──────────────────────────────────────────────
    const parseResult = stellarAddressSchema.safeParse(req.params.stellarAddress);
    if (!parseResult.success) {
      logger.warn(
        { reqId, stellarAddress: req.params.stellarAddress, issues: parseResult.error.issues },
        "user_profile_validation_failed",
      );
      return res.status(400).json({
        error: {
          code: "validation_error",
          message: parseResult.error.issues[0]?.message ?? "invalid stellar address",
          requestId: reqId,
        },
      });
    }

    const stellarAddress = parseResult.data;

    // ── 2. Service call ──────────────────────────────────────────────────
    try {
      logger.debug({ reqId, stellarAddress }, "user_profile_lookup");

      const profile = await getUserProfile(stellarAddress);

      if (!profile) {
        logger.debug({ reqId, stellarAddress }, "user_profile_not_found");
        return res.status(404).json({
          error: {
            code: "not_found",
            message: "no user found with that stellar address",
            requestId: reqId,
          },
        });
      }

      logger.debug(
        { reqId, stellarAddress, predictionCount: profile.predictions.length },
        "user_profile_found",
      );

      return res.json({ data: profile });
    } catch (err) {
      // Delegate to the global error handler which logs and returns a
      // standardised 500 envelope (including requestId).
      next(err);
    }
  },
);
