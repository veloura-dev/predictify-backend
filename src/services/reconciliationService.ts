import { db } from "../db";
import { predictions, users, reconciliationReports } from "../db/schema";
import { eq, desc } from "drizzle-orm";
import { logger } from "../config/logger";
import { v4 as uuidv4 } from "uuid";

export interface Discrepancy {
  predictionId: string;
  stellarAddress: string;
  marketId: string;
  dbAmount: string;
  onChainAmount: string;
  difference: string;
}

export interface ReconciliationResult {
  reportId: string;
  totalPredictions: number;
  matchedPredictions: number;
  unmatchedPredictions: number;
  discrepancies: Discrepancy[];
}

/**
 * Fetch on-chain prediction balance for a user in a specific market
 * This queries the Soroban contract for the user's position
 * 
 * NOTE: This is a placeholder implementation. The actual contract method name
 * and parameter encoding will depend on the Predictify Soroban contract interface.
 * You'll need to update this based on the actual contract ABI.
 */
async function getOnChainPredictionBalance(
  stellarAddress: string,
  marketId: string
): Promise<bigint | null> {
  try {
    // TODO: Implement actual contract call based on Predictify contract ABI
    // This will require:
    // 1. The correct contract method name (e.g., "balance", "get_position", etc.)
    // 2. Proper parameter encoding using xdr.ScVal
    // 3. Parsing the response using xdr.ScVal.fromXDR()
    
    // Placeholder: Return null to indicate on-chain data not available
    // Once contract interface is known, replace with actual implementation
    logger.warn(
      { stellarAddress, marketId },
      "On-chain balance fetching not yet implemented - contract ABI needed"
    );
    
    return null;
  } catch (error) {
    logger.error({ error, stellarAddress, marketId }, "Failed to fetch on-chain balance");
    return null;
  }
}

/**
 * Perform reconciliation between database predictions and on-chain balances
 */
export async function performReconciliation(): Promise<ReconciliationResult> {
  logger.info("Starting reconciliation process");
  
  const reportId = uuidv4();
  const discrepancies: Discrepancy[] = [];
  let matchedCount = 0;
  let unmatchedCount = 0;
  const batchSize = 10; // Process 10 predictions in parallel
  
  // Start the report
  await db.insert(reconciliationReports).values({
    id: reportId,
    status: "in_progress",
    totalPredictions: 0,
    matchedPredictions: 0,
    unmatchedPredictions: 0,
    discrepancies: [],
  });
  
  try {
    // Fetch all predictions with user and market info
    const allPredictions = await db
      .select({
        id: predictions.id,
        amount: predictions.amount,
        userId: predictions.userId,
        marketId: predictions.marketId,
        stellarAddress: users.stellarAddress,
      })
      .from(predictions)
      .innerJoin(users, eq(predictions.userId, users.id));
    
    logger.info({ total: allPredictions.length }, "Processing predictions for reconciliation");
    
    // Process predictions in batches for better performance
    for (let i = 0; i < allPredictions.length; i += batchSize) {
      const batch = allPredictions.slice(i, i + batchSize);
      
      const results = await Promise.all(
        batch.map(async (prediction) => {
          const onChainBalance = await getOnChainPredictionBalance(
            prediction.stellarAddress,
            prediction.marketId
          );
          
          if (onChainBalance === null) {
            logger.warn(
              { predictionId: prediction.id, stellarAddress: prediction.stellarAddress },
              "Failed to fetch on-chain balance, skipping"
            );
            return null;
          }
          
          const dbAmount = BigInt(prediction.amount);
          
          if (dbAmount === onChainBalance) {
            matchedCount++;
            return null;
          } else {
            unmatchedCount++;
            return {
              predictionId: prediction.id,
              stellarAddress: prediction.stellarAddress,
              marketId: prediction.marketId,
              dbAmount: prediction.amount,
              onChainAmount: onChainBalance.toString(),
              difference: (dbAmount - onChainBalance).toString(),
            };
          }
        })
      );
      
      // Add non-null results to discrepancies
      for (const result of results) {
        if (result) {
          discrepancies.push(result);
        }
      }
    }
    
    // Update the report with results
    await db
      .update(reconciliationReports)
      .set({
        completedAt: new Date(),
        status: "completed",
        totalPredictions: allPredictions.length,
        matchedPredictions: matchedCount,
        unmatchedPredictions: unmatchedCount,
        discrepancies: discrepancies,
      })
      .where(eq(reconciliationReports.id, reportId));
    
    logger.info(
      {
        reportId,
        total: allPredictions.length,
        matched: matchedCount,
        unmatched: unmatchedCount,
      },
      "Reconciliation completed"
    );
    
    return {
      reportId,
      totalPredictions: allPredictions.length,
      matchedPredictions: matchedCount,
      unmatchedPredictions: unmatchedCount,
      discrepancies,
    };
  } catch (error) {
    // Mark report as failed
    await db
      .update(reconciliationReports)
      .set({
        completedAt: new Date(),
        status: "failed",
        totalPredictions: 0,
        matchedPredictions: 0,
        unmatchedPredictions: 0,
        discrepancies: [],
      })
      .where(eq(reconciliationReports.id, reportId));
    
    logger.error({ error, reportId }, "Reconciliation failed");
    throw error;
  }
}

/**
 * Get reconciliation report by ID
 */
export async function getReconciliationReport(
  reportId: string
): Promise<ReconciliationResult | null> {
  const report = await db
    .select()
    .from(reconciliationReports)
    .where(eq(reconciliationReports.id, reportId))
    .limit(1);
  
  if (!report[0]) return null;
  
  return {
    reportId: report[0].id,
    totalPredictions: report[0].totalPredictions,
    matchedPredictions: report[0].matchedPredictions,
    unmatchedPredictions: report[0].unmatchedPredictions,
    discrepancies: report[0].discrepancies as Discrepancy[],
  };
}

/**
 * Get recent reconciliation reports
 */
export async function listReconciliationReports(limit: number = 10, offset: number = 0) {
  return db
    .select()
    .from(reconciliationReports)
    .orderBy(desc(reconciliationReports.startedAt))
    .limit(limit)
    .offset(offset);
}
