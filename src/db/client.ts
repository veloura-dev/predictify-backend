import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { env } from "../config/env";
import * as schema from "./schema";

/**
 * Shared Postgres pool + drizzle client.
 *
 * The starter shipped a schema but no client; this is the first real DB wiring.
 * Lazily created so importing the schema (e.g. in tooling/tests) never opens a
 * connection by side effect.
 */
let _pool: Pool | undefined;
let _db: ReturnType<typeof drizzle<typeof schema>> | undefined;

export function getPool(): Pool {
  if (!_pool) {
    _pool = new Pool({ connectionString: env.DATABASE_URL });
  }
  return _pool;
}

export function getDb() {
  if (!_db) {
    _db = drizzle(getPool(), { schema });
  }
  return _db;
}

export type Db = ReturnType<typeof getDb>;
