import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";

/**
 * Admin authorization guard.
 *
 * The repo ships JWT settings (JWT_SECRET/ISSUER/AUDIENCE) but no auth
 * middleware yet, so this is the first guard. It is intentionally small and
 * self-contained:
 *
 *   - Missing / malformed / invalid / expired token            -> 401
 *   - Valid token but the `role` claim is not "admin"          -> 403
 *   - Valid admin token                                        -> next()
 *
 * Tokens are verified against the configured secret, issuer and audience. The
 * decoded claims are attached to `req.auth` for downstream handlers/logging.
 */

export interface AuthClaims {
  sub: string;
  role?: string;
  [k: string]: unknown;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthClaims;
    }
  }
}

function deny(res: Response, status: 401 | 403, code: string) {
  res.status(status).json({ error: { code } });
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return deny(res, 401, "unauthorized");
  }
  const token = header.slice("Bearer ".length).trim();
  if (!token) return deny(res, 401, "unauthorized");

  let claims: AuthClaims;
  try {
    claims = jwt.verify(token, env.JWT_SECRET, {
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
    }) as AuthClaims;
  } catch {
    return deny(res, 401, "unauthorized");
  }

  if (claims.role !== "admin") {
    return deny(res, 403, "forbidden");
  }

  req.auth = claims;
  next();
}
