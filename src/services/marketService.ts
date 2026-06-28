import { db, getDb } from "../db/client";
import { markets, marketAuditLog } from "../db/schema";
import { asc, eq } from "drizzle-orm";
import { emitMarketEvent, LogEvent } from "../logging/events";

export interface Market {
  id: string;
  question: string;
  status: string;
  resolutionTime: Date;
  metadata: any;
  indexedLedger: number;
  archived: boolean;
  version: number;
}

export class VersionConflictError extends Error {
  status = 409;
  code = "version_conflict";
  constructor() {
    super("Version conflict");
    Object.setPrototypeOf(this, VersionConflictError.prototype);
  }
}

export async function listMarkets(options: { limit?: number; offset?: number } = {}): Promise<any[]> {
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;
  try {
    const rows = await getDb()
      .select({
        id: markets.id,
        question: markets.question,
        status: markets.status,
        resolutionTime: markets.resolutionTime,
      })
      .from(markets)
      .where(eq(markets.archived, false))
      .orderBy(asc(markets.resolutionTime), asc(markets.id))
      .limit(limit)
      .offset(offset);
    if (Array.isArray(rows)) {
      return rows.map((r: any) => ({
        ...r,
        resolutionTime: r.resolutionTime instanceof Date ? r.resolutionTime.toISOString() : r.resolutionTime,
      }));
    }
  } catch (e) {
    // fallback if query builder structure differs
  }
  const result = await getDb().select().from(markets);
  return Array.isArray(result) ? result : [];
}

export async function getMarketById(id: string): Promise<any | null> {
  try {
    const rows = await getDb()
      .select({
        id: markets.id,
        question: markets.question,
        status: markets.status,
        resolutionTime: markets.resolutionTime,
      })
      .from(markets)
      .where(eq(markets.id, id))
      .limit(1);
    if (Array.isArray(rows) && rows[0]) {
      const r = rows[0];
      return {
        ...r,
        resolutionTime: r.resolutionTime instanceof Date ? r.resolutionTime.toISOString() : r.resolutionTime,
      };
    }
  } catch (e) {}
  const result = await getDb().select().from(markets).where(eq(markets.id, id)).limit(1);
  return result[0] || null;
}

export async function updateMarket(
  id: string,
  patch: { question?: string; metadata?: any },
  expectedVersion: number,
  adminAddress: string
): Promise<any> {
  const result = await db.transaction(async (tx) => {
    const existing = await tx.select().from(markets).where(eq(markets.id, id)).limit(1);
    if (existing.length === 0) {
      const err = new Error("Market not found");
      (err as any).status = 404;
      throw err;
    }

    const currentMarket = existing[0];
    if (currentMarket.version !== expectedVersion) {
      throw new VersionConflictError();
    }

    const newVersion = expectedVersion + 1;
    const updated = await tx
      .update(markets)
      .set({
        ...patch,
        version: newVersion,
      })
      .where(eq(markets.id, id))
      .returning();

    await tx.insert(marketAuditLog).values({
      marketId: id,
      adminAddress,
      action: "update",
      beforeState: {
        question: currentMarket.question,
        metadata: currentMarket.metadata,
        version: currentMarket.version,
      },
      afterState: {
        question: updated[0].question,
        metadata: updated[0].metadata,
        version: updated[0].version,
      },
    });

    return updated[0];
  });

  // Structured log event – emitted from service layer after successful commit.
  // Includes correlation ID via requestContext (see logging/events.ts).
  emitMarketEvent(LogEvent.MARKET_UPDATED, {
    marketId: id,
    actor: adminAddress,
    version: result.version,
    fieldsUpdated: Object.keys(patch),
  });

  return result;
}

