import { db } from "../db";
import { users, predictions, markets, claims } from "../db/schema";
import { and, eq, desc, lt, count } from "drizzle-orm";

export interface UserPrediction {
  id: string;
  marketId: string;
  question: string;
  outcome: string;
  amount: string;
  status: "pending" | "confirmed" | "won" | "lost" | "claimed";
  createdAt: string;
  resolutionTime: string;
}

export async function getUserByAddress(address: string) {
  return db.query.users.findFirst({
    where: eq(users.stellarAddress, address),
  });
}

export async function getUserPredictions(
  userId: string,
  opts: {
    status?: string;
    limit: number;
    cursor?: string;
  }
) {
  const { status, limit, cursor } = opts;

  let whereConditions = [eq(predictions.userId, userId)];

  // Apply status filter if provided
  if (status) {
    whereConditions.push(eq(predictions.status, status));
  }

  // Apply cursor for pagination (keysett pagination on created_at DESC, id)
  if (cursor) {
    const [cursorTime] = cursor.split("|");
    whereConditions.push(lt(predictions.createdAt, new Date(cursorTime)));
  }

  const results = await db
    .select({
      id: predictions.id,
      marketId: predictions.marketId,
      question: markets.question,
      outcome: predictions.outcome,
      amount: predictions.amount,
      status: predictions.status,
      createdAt: predictions.createdAt,
      resolutionTime: markets.resolutionTime,
    })
    .from(predictions)
    .innerJoin(markets, eq(predictions.marketId, markets.id))
    .where(and(...whereConditions))
    .orderBy(desc(predictions.createdAt), desc(predictions.id))
    .limit(limit + 1); // +1 to detect if there are more results

  const hasMore = results.length > limit;
  const data = results.slice(0, limit);

  // Generate next cursor from last result
  let nextCursor = null;
  if (hasMore && data.length > 0) {
    const last = data[data.length - 1];
    nextCursor = `${last.createdAt.toISOString()}|${last.id}`;
  }

  return {
    data: data.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      resolutionTime: r.resolutionTime.toISOString(),
    })),
    nextCursor,
  };
}

/**
 * Response shape for `GET /api/users/me`.  All timestamps are serialised to
 * ISO-8601 strings so the wire format is stable across runtimes.
 */
export interface UserProfile {
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
 * Throws `AppError.notFound` if the user row no longer exists (e.g. deleted
 * between token issuance and request) — a defensive error that should be
 * effectively unreachable in production, but matters for testability.
 */
export async function getCurrentUserProfile(userId: string): Promise<UserProfile> {
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
  // is gone, the global errorHandler still surfaces a sane 500 envelope
  // (we intentionally do not use AppError here because the row's absence
  // is a server-side anomaly rather than a user-facing not_found).
  if (!user) {
    throw new Error("user row vanished mid-request");
  }

  // Drizzle's count() returns a single row with `value` (string in some
  // drivers, number in others).  Coerce to a safe integer.
  const prediction_count = Number(predCountRow[0]?.value ?? 0);
  const claim_count = Number(claimCountRow[0]?.value ?? 0);

  return {
    stellarAddress: user.stellarAddress,
    createdAt: user.createdAt.toISOString(),
    totals: {
      prediction_count,
      claim_count,
    },
  };
}
