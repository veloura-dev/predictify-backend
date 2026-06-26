import { z } from "zod";
import pino from "pino";

const _logger = pino({ level: "warn", base: { service: "predictify-backend" } });

const _schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  JWT_ISSUER: z.string().default("predictify"),
  JWT_AUDIENCE: z.string().default("predictify-app"),
  JWT_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  // Secret used to HMAC-sign outbound webhook bodies. Distinct from JWT_SECRET
  // so the two can be rotated independently.
  WEBHOOK_SIGNING_SECRET: z.string().min(16),
  STELLAR_NETWORK: z.enum(["testnet", "mainnet"]).default("testnet"),
  SOROBAN_RPC_URL: z.string().url(),
  HORIZON_URL: z.string().url(),
  PREDICTIFY_CONTRACT_ID: z.string().min(1),
  INDEXER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
  INDEXER_START_LEDGER: z.coerce.number().int().nonnegative().default(0),
  RECONCILIATION_ENABLED: z.coerce.boolean().default(true),
  RECONCILIATION_SCHEDULE: z.string().default("0 2 * * *"),
});

export const schema = _schema.refine(
  (data) => data.JWT_TTL_SECONDS >= data.WORKER_HEARTBEAT_SECONDS * 2,
  (data) => ({
    message: `JWT_TTL_SECONDS (${data.JWT_TTL_SECONDS}) must be at least WORKER_HEARTBEAT_SECONDS * 2 (${data.WORKER_HEARTBEAT_SECONDS * 2})`,
    path: ["JWT_TTL_SECONDS"],
  })
);

export const env = schema.parse(process.env);

const _minTtl = env.WORKER_HEARTBEAT_SECONDS * 2;
if (env.JWT_TTL_SECONDS < _minTtl * 1.1) {
  _logger.warn(
    { JWT_TTL_SECONDS: env.JWT_TTL_SECONDS, minimumRecommended: _minTtl },
    `JWT_TTL_SECONDS is within 10% of the minimum bound (${_minTtl}). Increase it to avoid worker token-expiry issues.`
  );
}

export type Env = z.infer<typeof _schema>;
