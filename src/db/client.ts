import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { env } from "../config/env";
import * as schema from "./schema";

// A single shared connection pool for the process. The indexer worker keeps the
// pool small since it performs one transaction per poll tick.
export const pool = new Pool({ connectionString: env.DATABASE_URL });

export const db = drizzle(pool, { schema });

export type Database = typeof db;
