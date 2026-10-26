import dotenv from "dotenv";
import { resolve } from "node:path";
import { generateApiKey } from "../api-keys.js";

dotenv.config({ path: resolve(process.cwd(), "../../.env") });

async function main(): Promise<void> {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const name = process.env.API_KEY_NAME?.trim() || "Admin CLI key";

  if (!email) {
    throw new Error("Set ADMIN_EMAIL before running this script.");
  }

  const { pool } = await import("../db.js");
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const user = await client.query(
      `SELECT id, email, role
       FROM users
       WHERE email = $1 AND is_active = TRUE
       FOR UPDATE`,
      [email]
    );

    if (user.rowCount !== 1 || user.rows[0].role !== "admin") {
      throw new Error("Active admin user not found for ADMIN_EMAIL.");
    }

    const { rawKey, keyPrefix, keyHash } = generateApiKey();

    const keyResult = await client.query(
      `INSERT INTO api_keys (user_id, name, key_prefix, key_hash)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [user.rows[0].id, name, keyPrefix, keyHash]
    );

    const newKey = keyResult.rows[0];

    // Record the CLI-created key without storing its secret.
    await client.query(
      `INSERT INTO audit_logs
         (user_id, api_key_id, action, resource_type,
          resource_id, outcome, request_id, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
      [
        user.rows[0].id,
        null,
        "api_key.create",
        "api_key",
        newKey.id,
        "success",
        null,
        JSON.stringify({
          targetUserId: user.rows[0].id,
          targetEmail: user.rows[0].email,
          name,
          keyPrefix,
          createdVia: "cli",
        }),
      ]
    );

    await client.query("COMMIT");

    console.log("API key created. Copy it now; it will not be shown again:");
    console.log(rawKey);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(
    "API-key creation failed:",
    error instanceof Error ? error.message : "Unknown error"
  );
  process.exitCode = 1;
});