import { env } from "../config/env";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { logger } from "../config/logger";
import * as sdk from "@stellar/stellar-sdk";
import { sql } from "drizzle-orm";

export interface ReadinessCheck {
  status: "pass" | "fail";
  message: string;
  timestamp: number;
}

export interface ReadinessStatus {
  db: ReadinessCheck;
  sorobanRpc: ReadinessCheck;
  indexerLag: ReadinessCheck;
}

export interface ReadinessResult {
  status: "ready" | "unready";
  checks: ReadinessStatus;
}

async function checkDatabase(db: NodePgDatabase): Promise<ReadinessCheck> {
  const start = Date.now();
  try {
    await Promise.race([
      db.execute(sql`SELECT 1`),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Database check timeout")), 1000);
      }),
    ]);
    return {
      status: "pass",
      message: "Database connection healthy",
      timestamp: Date.now() - start,
    };
  } catch (error) {
    logger.error({ error }, "Database health check failed");
    return {
      status: "fail",
      message: error instanceof Error ? error.message : "Database connection failed",
      timestamp: Date.now() - start,
    };
  }
}

async function checkSorobanRpc(): Promise<ReadinessCheck> {
  const start = Date.now();
  try {
    const client = new sdk.SorobanRpc.Server(env.SOROBAN_RPC_URL, {
      allowHttp: env.STELLAR_NETWORK === "testnet",
    });

    await Promise.race([
      client.getHealth(),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Soroban RPC check timeout")), 1000);
      }),
    ]);

    return {
      status: "pass",
      message: "Soroban RPC healthy",
      timestamp: Date.now() - start,
    };
  } catch (error) {
    logger.error({ error }, "Soroban RPC health check failed");
    return {
      status: "fail",
      message: error instanceof Error ? error.message : "Soroban RPC failed",
      timestamp: Date.now() - start,
    };
  }
}

async function checkIndexerLag(db: NodePgDatabase): Promise<ReadinessCheck> {
  const start = Date.now();
  const maxLag = Number(process.env.READINESS_MAX_LAG_LEDGERS) || 200;

  try {
    const { rows } = await Promise.race([
      db.execute(sql`
        WITH current_tip AS (
          SELECT ledger
          FROM soroban_get_ledger_entry(
            '0x0000000000000000000000000000000000000000000000000000000000'
          )
          WHERE key = 'current'
        ), latest_indexed AS (
          SELECT last_ledger
          FROM indexer_cursor
          ORDER BY updated_at DESC
          LIMIT 1
        )
        SELECT 
          COALESCE(lt.ledger, 0) - COALESCE(li.last_ledger, 0) AS lag
        FROM current_tip lt
        CROSS JOIN latest_indexed li
      `),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Indexer lag check timeout")), 1000);
      }),
    ]);

    const lag = Number(rows[0]?.lag) || 0;

    if (lag <= maxLag) {
      return {
        status: "pass",
        message: `Indexer lag healthy: ${lag} ≤ ${maxLag}`,
        timestamp: Date.now() - start,
      };
    } else {
      return {
        status: "fail",
        message: `Indexer lag too high: ${lag} > ${maxLag}`,
        timestamp: Date.now() - start,
      };
    }
  } catch (error) {
    logger.error({ error }, "Indexer lag health check failed");
    return {
      status: "fail",
      message: error instanceof Error ? error.message : "Indexer lag check failed",
      timestamp: Date.now() - start,
    };
  }
}

export async function performReadinessCheck(db: NodePgDatabase): Promise<ReadinessResult> {
  const checks = await Promise.allSettled([
    checkDatabase(db),
    checkSorobanRpc(),
    checkIndexerLag(db),
  ]);

  const results = {
    db: checks[0].status === "fulfilled" ? checks[0].value : {
      status: "fail",
      message: "Database check failed",
      timestamp: Date.now(),
    },
    sorobanRpc: checks[1].status === "fulfilled" ? checks[1].value : {
      status: "fail",
      message: "Soroban RPC check failed",
      timestamp: Date.now(),
    },
    indexerLag: checks[2].status === "fulfilled" ? checks[2].value : {
      status: "fail",
      message: "Indexer lag check failed",
      timestamp: Date.now(),
    },
  } as ReadinessStatus;

  const ready = results.db.status === "pass" && results.sorobanRpc.status === "pass" && results.indexerLag.status === "pass";

  return {
    status: ready ? "ready" : "unready",
    checks: results,
  };
}