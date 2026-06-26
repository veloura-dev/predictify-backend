import { rpc } from "@stellar/stellar-sdk";
import { env } from "../config/env";
import { logger } from "../config/logger";
import { db, pool } from "../db/client";
import { createDbCursorStore } from "../db/indexerRepository";
import { pollOnce, type PollDeps } from "../services/indexerService";

/**
 * Long-running Soroban indexer worker.
 *
 * Polls `SOROBAN_RPC_URL` every `INDEXER_POLL_INTERVAL_MS`, ingesting contract
 * events and advancing the durable cursor. On SIGTERM/SIGINT it stops scheduling
 * new ticks, lets the in-flight tick finish, then exits cleanly.
 */
async function main(): Promise<void> {
  const server = new rpc.Server(env.SOROBAN_RPC_URL, {
    allowHttp: env.SOROBAN_RPC_URL.startsWith("http://"),
  });

  const deps: PollDeps = {
    rpc: server,
    store: createDbCursorStore(db),
    contractId: env.PREDICTIFY_CONTRACT_ID,
    startLedger: env.INDEXER_START_LEDGER,
    logger,
  };

  let shuttingDown = false;
  let activeTick: Promise<unknown> = Promise.resolve();

  const requestShutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "indexer shutdown requested; draining current tick");
  };

  process.on("SIGTERM", requestShutdown);
  process.on("SIGINT", requestShutdown);

  logger.info(
    { rpc: env.SOROBAN_RPC_URL, interval: env.INDEXER_POLL_INTERVAL_MS },
    "indexer worker started",
  );

  // Sleep that wakes early if shutdown is requested, so SIGTERM is responsive
  // even between ticks.
  const sleep = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      const onSignal = (): void => {
        clearTimeout(timer);
        resolve();
      };
      process.once("SIGTERM", onSignal);
      process.once("SIGINT", onSignal);
    });

  while (!shuttingDown) {
    try {
      activeTick = pollOnce(deps);
      await activeTick;
    } catch (err) {
      // Cursor is untouched on failure; log and retry on the next tick.
      logger.error({ err }, "indexer tick failed");
    }
    if (shuttingDown) break;
    await sleep(env.INDEXER_POLL_INTERVAL_MS);
  }

  // Ensure the in-flight tick is fully settled before tearing down resources.
  await activeTick.catch(() => undefined);
  await pool.end();
  logger.info({}, "indexer worker stopped");
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error({ err }, "indexer worker crashed");
      process.exit(1);
    });
}
