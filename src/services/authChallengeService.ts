import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { authChallenges } from "../db/schema";

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export interface ChallengeResult {
  nonce: string;
  expiresAt: Date;
}

export function generateNonce(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function computeExpiresAt(): Date {
  return new Date(Date.now() + CHALLENGE_TTL_MS);
}

export async function createChallenge(stellarAddress: string): Promise<ChallengeResult> {
  const nonce = generateNonce();
  const expiresAt = computeExpiresAt();

  await db.insert(authChallenges).values({
    nonce,
    stellarAddress,
    expiresAt,
  });

  return { nonce, expiresAt };
}

export async function verifyAndConsume(nonce: string): Promise<ChallengeResult | null> {
  const [row] = await db
    .select()
    .from(authChallenges)
    .where(eq(authChallenges.nonce, nonce))
    .limit(1);

  if (!row) return null;
  if (row.used) return null;
  if (new Date() > row.expiresAt) return null;

  await db
    .update(authChallenges)
    .set({ used: true })
    .where(eq(authChallenges.nonce, nonce));

  return { nonce: row.nonce, expiresAt: row.expiresAt };
}
