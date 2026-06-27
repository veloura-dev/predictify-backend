import { Router } from "express";
import { z } from "zod";
import { getUserByAddress, getUserPredictions, getCurrentUserProfile } from "../services/userService";
import { requireAuthForbidden } from "../middleware/requireAuth";
import { AuthenticatedRequest } from "../middleware/auth";
import { logger } from "../config/logger";

export const usersRouter = Router();

// Stellar address validation pattern
const stellarAddressSchema = z.string().regex(/^G[A-Z2-7]{55}$/, "Invalid Stellar address");

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

    // Validate address format
    try {
      stellarAddressSchema.parse(address);
    } catch (e) {
      return res.status(400).json({ error: { code: "invalid_address" } });
    }

    // Validate query params
    const querySchema = z.object({
      status: z.enum(["pending", "confirmed", "won", "lost", "claimed"]).optional(),
      cursor: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(100),
    });

    const query = querySchema.parse({ status, cursor, limit: parseInt(limit as string) });

    // Find user
    const user = await getUserByAddress(address);
    if (!user) {
      return res.status(404).json({ error: { code: "not_found" } });
    }

    // Get predictions
    const result = await getUserPredictions(user.id, {
      status: query.status,
      limit: query.limit,
      cursor: query.cursor,
    });

    return res.json({
      data: result.data,
      nextCursor: result.nextCursor,
    });
  } catch (e) {
    next(e);
    return;
  }
});
