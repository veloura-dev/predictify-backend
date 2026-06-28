import { db } from "../db";
import { users, predictions, markets, claims } from "../db/schema";
import { and, eq, desc, lt, count } from "drizzle-orm";
import { Result, ok, err } from "../errors/RouteError";

// ── Types ─────────────────────────────────────────────────────────────────

/** One entry in the public prediction history. */
export interface PredictionEntry {
  /** UUID of the prediction row. */
  id: string;
  /** The market this prediction was placed on. */
  market: {
    id: string;
    question: string;
    status: string;
    resolutionTime: string;
  };
  /** Which outcome the user chose (e.g. "yes" / "no"). */
  outcome: string;
  /**
   * Amount staked, stored as a string to preserve precision for large
   * Stellar stroops values.
   */
  amount: string;
  /** ISO-8601 timestamp when the prediction was created. */
  createdAt: string;
}

/** Aggregate totals derived from the user's full prediction history. */
export interface ProfileTotals {
  /** Total number of predictions the user has placed. */
  totalPredictions: number;
  /**
   * Sum of all staked amounts as a string.
   * Computed by the service; callers should treat this as opaque.
   */
  totalAmountStaked: string;
  /** Number of predictions on markets that resolved in the user's favour. */
  wins: number;
  /** Number of predictions on markets that resolved against the user. */
  losses: number;
}

/** Full public profile payload returned by the route. */
export interface UserProfile {
  /** Internal UUID (opaque to external consumers). */
  id: string;
  /** The user's public Stellar address — also the primary lookup key. */
  stellarAddress: string;
  /** ISO-8601 timestamp of account creation. */
  joinedAt: string;
  /** Ordered newest-first list of predictions. */
  predictions: PredictionEntry[];
  /** Pre-computed aggregate statistics. */
  totals: ProfileTotals;
}

// ── Service functions ─────────────────────────────────────────────────────

/**
 * Look up a public user profile by Stellar address.
 *
 * Returns `null` when no user with that address exists.
 *
 * Production implementation should:
 *  1. SELECT the user row by `stellar_address`.
 *  2. JOIN predictions → markets, ordered by `predictions.created_at DESC`.
 *  3. Compute totals in SQL (COUNT, SUM) to avoid pulling every row into JS.
 *
 * @param stellarAddress - The Stellar account address to look up.
 */
export async function getUserProfile(
  stellarAddress: string,
): Promise<UserProfile | null> {
  // Stub: always returns null until the DB layer is wired up.
  // Replace with a Drizzle query against the real connection pool.
  void stellarAddress;
  return null;
}

/**
 * Response shape for `GET /api/users/me`.  All timestamps are serialised to
 * ISO-8601 strings so the wire format is stable across runtimes.
 */
export interface CurrentUserProfile {
  /** The user's on-chain Stellar address (G...). */
  stellarAddress: string;
  /** Account creation timestamp (ISO-8601). */
  createdAt: string;
  /** Aggregate counters for the user's activity on the platform. */
  totals: {
    /** Total number of predictions the user has placed. */
    prediction_count: number;
    /** Total number of winnings claims the user has submitted. */
    claim_count: number;
  };
}

/**
 * Returns the authenticated user's profile (stellarAddress, createdAt) along
 * with aggregate counts of their predictions and claims.  Three queries run
 * in parallel via Promise.all:
 *
 *   1. users      — by PK (UUID), cheap point-lookup
 *   2. predictions — COUNT(*) filtered by user_id (FK index)
 *   3. claims      — COUNT(*) filtered by user_id (FK index)
 *
 * The user row is fetched here rather than passed in by the route so the
 * caller can pass a single argument (req.user.id) and the shape derivable
 * from `users` is always in sync with the live DB.
 *
 * Returns Unauthorized if the user row no longer exists (e.g. deleted
 * between token issuance and request) — a defensive error that should be
 * effectively unreachable in production, but matters for testability.
 */
export async function getCurrentUserProfile(userId: string): Promise<Result<CurrentUserProfile>> {
  const [userRow, predCountRow, claimCountRow] = await Promise.all([
    db
      .select({
        stellarAddress: users.stellarAddress,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1),
    db
      .select({ value: count() })
      .from(predictions)
      .where(eq(predictions.userId, userId)),
    db
      .select({ value: count() })
      .from(claims)
      .where(eq(claims.userId, userId)),
  ]);

  const user = userRow[0];
  // requireAuthForbidden already verified the user row exists at JWT
  // verification time, so this branch is effectively unreachable.  It is
  // kept as a robustness check against a TOCTOU deletion race: if the row
  // is gone, return NotFound instead of throwing.
  if (!user) {
    return err({
      kind: "NotFound",
      message: "User not found",
      resource: "User",
    });
  }

  // Drizzle's count() returns a single row with `value` (string in some
  // drivers, number in others).  Coerce to a safe integer.
  const prediction_count = Number(predCountRow[0]?.value ?? 0);
  const claim_count = Number(claimCountRow[0]?.value ?? 0);

  return ok({
    stellarAddress: user.stellarAddress,
    createdAt: user.createdAt.toISOString(),
    totals: {
      prediction_count,
      claim_count,
    },
  });
}
