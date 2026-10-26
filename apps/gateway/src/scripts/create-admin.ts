
import dotenv from "dotenv";
import { resolve } from "node:path";
import bcrypt from "bcrypt";

dotenv.config({ path: resolve(process.cwd(), "../../.env") });

async function main(): Promise<void> {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  const { pool } = await import("../db.js");

  try {
    if (!email || !password) {
      throw new Error(
        "Set ADMIN_EMAIL and ADMIN_PASSWORD before running this script."
      );
    }

    if (password.length < 12) {
      throw new Error("ADMIN_PASSWORD must be at least 12 characters.");
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const result = await pool.query(
      `INSERT INTO users (email, password_hash, role)
       VALUES ($1, $2, 'admin')
       ON CONFLICT (email) DO NOTHING
       RETURNING id, email, role`,
      [email, passwordHash]
    );

    if (result.rowCount === 0) {
      console.log("This email already exists. No changes made.");
    } else {
      console.log("Admin user created successfully:");
      console.log(result.rows[0]);
    }
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(
    "Admin bootstrap failed:",
    error instanceof Error ? error.message : "Unknown error"
  );
  process.exitCode = 1;
});
