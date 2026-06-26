import { envSchema } from "./env-schema";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  JWT_ISSUER: z.string().default("predictify"),
  JWT_AUDIENCE: z.string().default("predictify-app"),
  JWT_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  STELLAR_NETWORK: z.enum(["testnet", "mainnet"]).default("testnet"),
  SOROBAN_RPC_URL: z.string().url(),
  HORIZON_URL: z.string().url(),
  PREDICTIFY_CONTRACT_ID: z.string().min(1),
  INDEXER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
  INDEXER_START_LEDGER: z.coerce.number().int().nonnegative().default(0),
  INDEXER_REWIND_LEDGERS: z.coerce.number().int().nonnegative().default(100),
  INDEXER_GAP_SCAN_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
  INDEXER_BACKFILL_CHUNK_SIZE: z.coerce.number().int().positive().default(1_000),
});

export const env = schema.parse(process.env);
export type Env = z.infer<typeof schema>;
