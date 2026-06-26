/**
 * Jest setup: provide the env vars that `src/config/env.ts` validates at import
 * time. Without this, simply importing the app throws a zod error (the starter's
 * own health test fails in a clean clone). Values are dummy/test-only.
 */
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/predictify_test";
process.env.JWT_SECRET =
  process.env.JWT_SECRET ?? "test-jwt-secret-at-least-32-bytes-long-000000";
process.env.JWT_ISSUER = process.env.JWT_ISSUER ?? "predictify";
process.env.JWT_AUDIENCE = process.env.JWT_AUDIENCE ?? "predictify-app";
process.env.WEBHOOK_SIGNING_SECRET =
  process.env.WEBHOOK_SIGNING_SECRET ?? "test-webhook-signing-secret";
process.env.SOROBAN_RPC_URL =
  process.env.SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org";
process.env.HORIZON_URL = process.env.HORIZON_URL ?? "https://horizon-testnet.stellar.org";
process.env.PREDICTIFY_CONTRACT_ID = process.env.PREDICTIFY_CONTRACT_ID ?? "CTEST";
