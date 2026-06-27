import { db } from "../db";
import { sql } from "drizzle-orm";

export interface LeaderboardEntry extends Record<string, unknown> {
  user_id: string;
  stellar_address: string;
  total_predictions: number;
  correct_predictions: number;
  accuracy_percentage: number;
  rank: number;
}

/**
 * Refresh the leaderboard materialized view
 * This should be called periodically (e.g., via cron or after market resolutions)
 */
export async function refreshLeaderboard(): Promise<void> {
  await db.execute(sql`REFRESH MATERIALIZED VIEW CONCURRENTLY leaderboard_mv`);
}

/**
 * Get the leaderboard with optional limit and offset
 * @param limit - Maximum number of entries to return (default: 50)
 * @param offset - Number of entries to skip (default: 0)
 */
export async function getLeaderboard(
  limit: number = 50,
  offset: number = 0
): Promise<LeaderboardEntry[]> {
  const result = await db.execute<LeaderboardEntry>(
    sql`
      SELECT user_id, stellar_address, total_predictions, correct_predictions, 
             accuracy_percentage, rank
      FROM leaderboard_mv
      ORDER BY rank ASC
      LIMIT ${limit}
      OFFSET ${offset}
    `
  );
  return result.rows;
}

/**
 * Get a specific user's leaderboard entry by stellar address
 * @param stellarAddress - The user's Stellar address
 */
export async function getUserLeaderboardEntry(
  stellarAddress: string
): Promise<LeaderboardEntry | null> {
  const result = await db.execute<LeaderboardEntry>(
    sql`
      SELECT user_id, stellar_address, total_predictions, correct_predictions, 
             accuracy_percentage, rank
      FROM leaderboard_mv
      WHERE stellar_address = ${stellarAddress}
      LIMIT 1
    `
  );
  return result.rows[0] || null;
}

/**
 * Get leaderboard with automatic refresh
 * This refreshes the materialized view before returning data
 * Use this when you need the most up-to-date data
 */
export async function getLeaderboardWithRefresh(
  limit: number = 50,
  offset: number = 0
): Promise<LeaderboardEntry[]> {
  await refreshLeaderboard();
  return getLeaderboard(limit, offset);
}
