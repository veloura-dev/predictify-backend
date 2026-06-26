import { Router } from "express";
import { z } from "zod";
import { StrKey } from "@stellar/stellar-sdk";
import { createChallenge } from "../services/authChallengeService";
import { verifyChallengeAndIssueJwt } from "../services/authVerifyService";

export const authRouter = Router();

const challengeBodySchema = z.object({
  stellarAddress: z.string().refine(
    (addr) => StrKey.isValidEd25519PublicKey(addr),
    { message: "Invalid Stellar ed25519 public key" },
  ),
});

authRouter.post("/challenge", async (req, res, next) => {
  try {
    const parsed = challengeBodySchema.safeParse(req.body);
    if (!parsed.success) {
      const err = new Error("Invalid stellar address") as Error & { status: number; code: string };
      err.status = 400;
      err.code = "invalid_address";
      throw err;
    }

    const result = await createChallenge(parsed.data.stellarAddress);
    res.status(201).json({
      nonce: result.nonce,
      expiresAt: result.expiresAt.toISOString(),
    });
  } catch (e) { next(e); }
});

const verifyBodySchema = z.object({
  stellarAddress: z.string().refine(
    (addr) => StrKey.isValidEd25519PublicKey(addr),
    { message: "Invalid Stellar ed25519 public key" },
  ),
  nonce: z.string().min(1),
  signature: z.string().min(1),
});

authRouter.post("/verify", async (req, res, next) => {
  try {
    const parsed = verifyBodySchema.safeParse(req.body);
    if (!parsed.success) {
      const err = new Error("Invalid auth verify request") as Error & { status: number; code: string };
      err.status = 400;
      err.code = "invalid_request";
      throw err;
    }

    const result = await verifyChallengeAndIssueJwt(
      parsed.data.stellarAddress,
      parsed.data.nonce,
      parsed.data.signature,
    );

    res.status(200).json(result);
  } catch (e) { next(e); }
});
