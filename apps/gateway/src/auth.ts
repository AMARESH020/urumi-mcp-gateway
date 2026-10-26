import type { NextFunction, Request, Response } from "express";
import { pool } from "./db.js";
import { hashApiKey } from "./api-keys.js";

export interface AuthenticatedRequest extends Request {
  auth?: {
    userId: string;
    email: string;
    role: "admin" | "member";
    apiKeyId: string;
  };
}

export async function authenticateApiKey(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  const authorization = req.header("authorization");
  const match = authorization?.match(/^Bearer (urumi_[A-Za-z0-9_-]+)$/);

  if (!match) {
    res.status(401).json({ error: "Missing or invalid bearer token" });
    return;
  }

  try {
    const keyHash = hashApiKey(match[1]);

    const result = await pool.query(
      `SELECT
         ak.id AS api_key_id,
         u.id AS user_id,
         u.email,
         u.role
       FROM api_keys ak
       JOIN users u ON u.id = ak.user_id
       WHERE ak.key_hash = $1
         AND ak.revoked_at IS NULL
         AND (ak.expires_at IS NULL OR ak.expires_at > NOW())
         AND u.is_active = TRUE`,
      [keyHash]
    );

    if (result.rowCount !== 1) {
      res.status(401).json({ error: "Invalid, expired, or revoked API key" });
      return;
    }

    const row = result.rows[0];

    await pool.query(
      "UPDATE api_keys SET last_used_at = NOW() WHERE id = $1",
      [row.api_key_id]
    );

    req.auth = {
      userId: row.user_id,
      email: row.email,
      role: row.role,
      apiKeyId: row.api_key_id
    };

    next();
  } catch {
    res.status(503).json({ error: "Authentication service unavailable" });
  }
}
export function requireAdmin(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void {
  if (!req.auth) {
    res.status(401).json({
      error: "Authentication required",
    });
    return;
  }

  if (req.auth.role !== "admin") {
    res.status(403).json({
      error: "Administrator privileges required",
    });
    return;
  }

  next();
}
