import jwt from "jsonwebtoken";
import { Keypair } from "@stellar/stellar-sdk";
import { env } from "../config/env";
import { verifyAndConsume } from "./authChallengeService";
import { upsertUserByStellarAddress } from "../db/userRepo";

export interface AuthVerifyResult {
  accessToken: string;
  expiresIn: number;
}

export class AuthVerifyError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number) {
    super(message);
    this.name = "AuthVerifyError";
  }
}

export async function verifyChallengeAndIssueJwt(
  stellarAddress: string,
  nonce: string,
  signature: string,
): Promise<AuthVerifyResult> {
  const challenge = await verifyAndConsume(nonce);
  if (!challenge) {
    throw new AuthVerifyError("challenge_used", "Challenge is invalid, expired, or already used", 401);
  }

  const keypair = Keypair.fromPublicKey(stellarAddress);
  const message = Buffer.from(challenge.nonce, "utf8");

  if (!keypair.verify(message, Buffer.from(signature, "base64"))) {
    throw new AuthVerifyError("bad_signature", "Signature did not match the provided Stellar address", 401);
  }

  const user = await upsertUserByStellarAddress(stellarAddress);

  const accessToken = jwt.sign(
    { sub: user.stellarAddress },
    env.JWT_SECRET,
    {
      expiresIn: env.JWT_TTL_SECONDS,
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
    },
  );

  return {
    accessToken,
    expiresIn: env.JWT_TTL_SECONDS,
  };
}
