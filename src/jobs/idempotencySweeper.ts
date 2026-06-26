/**
 * Sweeper job: deletes expired idempotency_records rows.
 * Runs on a configurable interval (default: every hour).
 */
import { lt } from "drizzle-orm";
import { db } from "../db";
import { idempotencyRecords } from "../db/schema";
import { logger } from "../config/logger";

const INTERVAL_MS = 60 * 60 * 1000; // 1 hour

export function startIdempotencySweeper(): NodeJS.Timeout {
  return setInterval(async () => {
    try {
      const result = await db
        .delete(idempotencyRecords)
        .where(lt(idempotencyRecords.expiresAt, new Date()));
      logger.info({ deleted: (result as { rowCount?: number }).rowCount ?? 0 }, "idempotency_sweep");
    } catch (err) {
      logger.error({ err }, "idempotency_sweep_failed");
    }
  }, INTERVAL_MS);
}
