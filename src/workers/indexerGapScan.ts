import { env } from "../config/env";
import { logger } from "../config/logger";
import { indexerGapDetectedTotal } from "../metrics/registry";
import { IndexerService, LedgerGap, indexerService } from "../services/indexerService";

export interface GapScanResult {
  gaps: LedgerGap[];
  scanFrom: number;
  scanTo: number;
}

/**
 * Runs one gap scan between the durable cursor (minus rewind window) and chain tip.
 * Each detected gap triggers exactly one backfill spanning that range.
 */
export async function scanOnce(service: IndexerService = indexerService): Promise<GapScanResult> {
  const cursor = await service.getCursor();
  const tip = await service.getChainTip();
  const scanFrom = Math.max(env.INDEXER_START_LEDGER, cursor - env.INDEXER_REWIND_LEDGERS);
  const scanTo = tip;

  if (scanFrom > scanTo) {
    return { gaps: [], scanFrom, scanTo };
  }

  const gaps = await service.detectGaps(scanFrom, scanTo, cursor);

  for (const gap of gaps) {
    indexerGapDetectedTotal.inc({ from: gap.from, to: gap.to });
    logger.warn({ from: gap.from, to: gap.to }, "indexer_gap_detected");
    await service.backfillRange(gap.from, gap.to);
  }

  return { gaps, scanFrom, scanTo };
}

export interface GapScanWorkerHandle {
  stop(): void;
}

/** Starts a cron-like interval worker; returns a handle to stop it. */
export function startGapScanWorker(service: IndexerService = indexerService): GapScanWorkerHandle {
  const intervalMs = env.INDEXER_GAP_SCAN_INTERVAL_MS;
  logger.info({ intervalMs }, "indexer gap scan worker started");

  const timer = setInterval(() => {
    void scanOnce(service).catch((error: unknown) => {
      logger.error({ err: error }, "indexer gap scan tick failed");
    });
  }, intervalMs);

  if (typeof timer.unref === "function") {
    timer.unref();
  }

  return {
    stop() {
      clearInterval(timer);
      logger.info("indexer gap scan worker stopped");
    },
  };
}

if (require.main === module) {
  startGapScanWorker();
}
