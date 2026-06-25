import { Router } from "express";
import { z } from "zod";
import { StrKey } from "@stellar/stellar-sdk";
import { createChallenge } from "../services/authChallengeService";

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
