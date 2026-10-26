import { createHash, randomBytes } from "node:crypto";

const KEY_PREFIX = "urumi_";

export function generateApiKey() {
  const secret = randomBytes(32).toString("base64url");
  const rawKey = `${KEY_PREFIX}${secret}`;

  return {
    rawKey,
    keyPrefix: rawKey.slice(0, 14),
    keyHash: hashApiKey(rawKey)
  };
}

export function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}
