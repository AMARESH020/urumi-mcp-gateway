import bcrypt from "bcrypt";
import { generateApiKey } from "./api-keys.js";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Router } from "express";
import { z } from "zod";
import { pool } from "./db.js";
import {
  authenticateApiKey,
  requireAdmin,
  type AuthenticatedRequest,
} from "./auth.js";

export const protectedRouter = Router();

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

protectedRouter.get("/me", authenticateApiKey, (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;

  res.json({
    userId: auth.userId,
    email: auth.email,
    role: auth.role,
  });
});

// List recent audit events.
// Admins can view all events; members can view only their own.
protectedRouter.get(
  "/audit-logs",
  authenticateApiKey,
  async (req, res) => {
    const auth = (req as AuthenticatedRequest).auth!;

    const requestedLimit =
      typeof req.query.limit === "string"
        ? Number(req.query.limit)
        : 50;

    if (
      !Number.isInteger(requestedLimit) ||
      requestedLimit < 1 ||
      requestedLimit > 100
    ) {
      res.status(400).json({
        error: "Limit must be an integer between 1 and 100.",
      });
      return;
    }

    try {
      const result = await pool.query(
        `SELECT
          id,
          user_id,
          (
            SELECT email
            FROM users
            WHERE users.id = audit_logs.user_id
          ) AS user_email,
          action,
          resource_type,
          resource_id,
          outcome,
          request_id,
          details ->> 'serverName' AS server_name,
          details ->> 'exposedToolName' AS exposed_tool_name,
          details ->> 'upstreamToolName' AS upstream_tool_name,
          details ->> 'durationMs' AS duration_ms,
          details ->> 'toolName' AS action_tool_name,
          details ->> 'status' AS action_status,
          details ->> 'name' AS resource_name,
          details ->> 'isEnabled' AS is_enabled,
          created_at
        FROM audit_logs
        WHERE ($1::boolean OR user_id = $2)
        ORDER BY created_at DESC, id DESC
        LIMIT $3`,
        [auth.role === "admin", auth.userId, requestedLimit],
      );

      res.json({ events: result.rows });
    } catch {
      res.status(503).json({
        error: "Unable to retrieve audit logs.",
      });
    }
  },
);

// List the authenticated user's API keys.
// Never return the raw key or its stored hash.
protectedRouter.get("/keys", authenticateApiKey, async (req, res) => {
  const auth = (req as AuthenticatedRequest).auth!;

  try {
    const result = await pool.query(
      `SELECT
         id,
         name,
         key_prefix,
         created_at,
         last_used_at,
         expires_at,
         revoked_at,
         (id = $2) AS is_current
       FROM api_keys
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [auth.userId, auth.apiKeyId],
    );

    res.json({ apiKeys: result.rows });
  } catch {
    res.status(503).json({ error: "API-key service unavailable" });
  }
});

// Revoke one of the authenticated user's API keys.
protectedRouter.delete(
  "/keys/:id",
  authenticateApiKey,
  async (req, res) => {
    const auth = (req as AuthenticatedRequest).auth!;
    const keyId = req.params.id;

    if (typeof keyId !== "string" || !UUID_PATTERN.test(keyId)) {
      res.status(400).json({ error: "Invalid API-key ID" });
      return;
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const result = await client.query(
        `UPDATE api_keys
         SET revoked_at = NOW()
         WHERE id = $1
           AND user_id = $2
           AND revoked_at IS NULL
         RETURNING id, name, key_prefix`,
        [keyId, auth.userId],
      );

      if (result.rowCount !== 1) {
        await client.query("ROLLBACK");
        res.status(404).json({
          error: "Active API key not found for this user",
        });
        return;
      }

      const revokedKey = result.rows[0];

      await client.query(
        `INSERT INTO audit_logs
           (user_id, api_key_id, action, resource_type,
            resource_id, outcome, request_id, details)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
        [
          auth.userId,
          auth.apiKeyId,
          "api_key.revoke",
          "api_key",
          revokedKey.id,
          "success",
          req.header("x-request-id") ?? null,
          JSON.stringify({
            name: revokedKey.name,
            keyPrefix: revokedKey.key_prefix,
          }),
        ],
      );

      await client.query("COMMIT");

      res.json({
        message: "API key revoked successfully",
        apiKey: {
          id: revokedKey.id,
          name: revokedKey.name,
          keyPrefix: revokedKey.key_prefix,
        },
      });
    } catch {
      await client.query("ROLLBACK").catch(() => undefined);
      res.status(503).json({
        error: "Unable to revoke API key",
      });
    } finally {
      client.release();
    }
  },
);

// ---------------------------------------------------------------------------
// Admin-only member management
// ---------------------------------------------------------------------------

const createMemberSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(12).max(128),
});

const createMemberKeySchema = z.object({
  name: z.string().trim().min(1).max(100),
});

// List users without exposing password hashes or raw API keys.
protectedRouter.get(
  "/users",
  authenticateApiKey,
  requireAdmin,
  async (_req, res) => {
    try {
      const result = await pool.query(
        `SELECT
           u.id,
           u.email,
           u.role,
           u.is_active,
           u.created_at,
           u.updated_at,
           (
             SELECT COUNT(*)::int
             FROM api_keys ak
             WHERE ak.user_id = u.id
               AND ak.revoked_at IS NULL
               AND (ak.expires_at IS NULL OR ak.expires_at > NOW())
           ) AS active_key_count
         FROM users u
         ORDER BY u.created_at DESC`,
      );

      res.json({ users: result.rows });
    } catch (error: unknown) {
      console.error(
        "Unable to list users:",
        error instanceof Error ? error.message : "Unknown error",
      );

      res.status(503).json({
        error: "Unable to retrieve users.",
      });
    }
  },
);

// Create a member account with a bcrypt-hashed password.
protectedRouter.post(
  "/users",
  authenticateApiKey,
  requireAdmin,
  async (req, res) => {
    const parsed = createMemberSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        error: "Provide a valid email and a password of 12–128 characters.",
      });
      return;
    }

    const email = parsed.data.email.toLowerCase();
    const passwordHash = await bcrypt.hash(parsed.data.password, 12);
    const auth = (req as AuthenticatedRequest).auth!;

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const result = await client.query(
        `INSERT INTO users (email, password_hash, role)
         VALUES ($1, $2, 'member')
         RETURNING id, email, role, is_active, created_at`,
        [email, passwordHash],
      );

      const member = result.rows[0];

      await client.query(
        `INSERT INTO audit_logs
           (user_id, api_key_id, action, resource_type,
            resource_id, outcome, request_id, details)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
        [
          auth.userId,
          auth.apiKeyId,
          "user.create",
          "user",
          member.id,
          "success",
          req.header("x-request-id")?.slice(0, 200) ?? null,
          JSON.stringify({
            email: member.email,
            role: member.role,
          }),
        ],
      );

      await client.query("COMMIT");

      res.status(201).json({ user: member });
    } catch (error: unknown) {
      await client.query("ROLLBACK").catch(() => undefined);

      const code =
        typeof error === "object" &&
        error !== null &&
        "code" in error
          ? String(error.code)
          : "";

      if (code === "23505") {
        res.status(409).json({
          error: "A user with this email already exists.",
        });
        return;
      }

      console.error(
        "Unable to create member:",
        error instanceof Error ? error.message : "Unknown error",
      );

      res.status(503).json({
        error: "Unable to create member.",
      });
    } finally {
      client.release();
    }
  },
);

// List API-key metadata for a selected user.
// Raw keys and stored hashes are never returned.
protectedRouter.get(
  "/users/:id/keys",
  authenticateApiKey,
  requireAdmin,
  async (req, res) => {
    const userId = req.params.id;

    if (typeof userId !== "string" || !UUID_PATTERN.test(userId)) {
      res.status(400).json({
        error: "Invalid user ID.",
      });
      return;
    }

    try {
      const userResult = await pool.query(
        "SELECT id FROM users WHERE id = $1",
        [userId],
      );

      if (userResult.rows.length === 0) {
        res.status(404).json({
          error: "User not found.",
        });
        return;
      }

      const keyResult = await pool.query(
        `SELECT
           id,
           name,
           key_prefix,
           created_at,
           last_used_at,
           expires_at,
           revoked_at
         FROM api_keys
         WHERE user_id = $1
         ORDER BY created_at DESC`,
        [userId],
      );

      res.json({
        keys: keyResult.rows,
      });
    } catch (error: unknown) {
      console.error(
        "Unable to list user API keys:",
        error instanceof Error ? error.message : "Unknown error",
      );

      res.status(503).json({
        error: "Unable to load API keys.",
      });
    }
  },
);

// Issue an API key for a selected active user.
// The raw key is returned only once.
protectedRouter.post(
  "/users/:id/keys",
  authenticateApiKey,
  requireAdmin,
  async (req, res) => {
    const userId = req.params.id;

    if (typeof userId !== "string" || !UUID_PATTERN.test(userId)) {
      res.status(400).json({
        error: "Invalid user ID.",
      });
      return;
    }

    const parsed = createMemberKeySchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        error: "Provide an API-key name between 1 and 100 characters.",
      });
      return;
    }

    const auth = (req as AuthenticatedRequest).auth!;
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const userResult = await client.query(
        `SELECT id, email
         FROM users
         WHERE id = $1 AND is_active = TRUE`,
        [userId],
      );

      if (userResult.rowCount !== 1) {
        await client.query("ROLLBACK");

        res.status(404).json({
          error: "Active user not found.",
        });
        return;
      }

      const { rawKey, keyPrefix, keyHash } = generateApiKey();

      const keyResult = await client.query(
        `INSERT INTO api_keys (user_id, name, key_prefix, key_hash)
         VALUES ($1, $2, $3, $4)
         RETURNING id, name, key_prefix, created_at, expires_at`,
        [userId, parsed.data.name, keyPrefix, keyHash],
      );

      const newKey = keyResult.rows[0];

      await client.query(
        `INSERT INTO audit_logs
           (user_id, api_key_id, action, resource_type,
            resource_id, outcome, request_id, details)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
        [
          auth.userId,
          auth.apiKeyId,
          "api_key.create",
          "api_key",
          newKey.id,
          "success",
          req.header("x-request-id")?.slice(0, 200) ?? null,
          JSON.stringify({
            targetUserId: userId,
            targetEmail: userResult.rows[0].email,
            name: newKey.name,
            keyPrefix: newKey.key_prefix,
          }),
        ],
      );

      await client.query("COMMIT");

      res.status(201).json({
        message:
          "API key created. Store the raw key securely; it will not be shown again.",
        user: {
          id: userResult.rows[0].id,
          email: userResult.rows[0].email,
        },
        apiKey: {
          id: newKey.id,
          name: newKey.name,
          keyPrefix: newKey.key_prefix,
          createdAt: newKey.created_at,
          expiresAt: newKey.expires_at,
          rawKey,
        },
      });
    } catch (error: unknown) {
      await client.query("ROLLBACK").catch(() => undefined);

      console.error(
        "Unable to create user API key:",
        error instanceof Error ? error.message : "Unknown error",
      );

      res.status(503).json({
        error: "Unable to create API key.",
      });
    } finally {
      client.release();
    }
  },
);

// Revoke a key belonging to any user.
// Administrator permission is required.
protectedRouter.delete(
  "/users/:userId/keys/:keyId",
  authenticateApiKey,
  requireAdmin,
  async (req, res) => {
    const userId = req.params.userId;
    const keyId = req.params.keyId;

    if (
      typeof userId !== "string" ||
      !UUID_PATTERN.test(userId) ||
      typeof keyId !== "string" ||
      !UUID_PATTERN.test(keyId)
    ) {
      res.status(400).json({
        error: "Invalid user ID or API-key ID.",
      });
      return;
    }

    const auth = (req as AuthenticatedRequest).auth!;
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const result = await client.query(
        `UPDATE api_keys
         SET revoked_at = NOW()
         WHERE id = $1
           AND user_id = $2
           AND revoked_at IS NULL
         RETURNING id, name, key_prefix`,
        [keyId, userId],
      );

      if (result.rowCount !== 1) {
        await client.query("ROLLBACK");

        res.status(404).json({
          error: "Active API key not found for this user.",
        });
        return;
      }

      const revokedKey = result.rows[0];

      await client.query(
        `INSERT INTO audit_logs
           (user_id, api_key_id, action, resource_type,
            resource_id, outcome, request_id, details)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
        [
          auth.userId,
          auth.apiKeyId,
          "api_key.revoke",
          "api_key",
          revokedKey.id,
          "success",
          req.header("x-request-id")?.slice(0, 200) ?? null,
          JSON.stringify({
            targetUserId: userId,
            name: revokedKey.name,
            keyPrefix: revokedKey.key_prefix,
          }),
        ],
      );

      await client.query("COMMIT");

      res.json({
        message: "API key revoked successfully.",
        apiKey: {
          id: revokedKey.id,
          name: revokedKey.name,
          keyPrefix: revokedKey.key_prefix,
        },
      });
    } catch (error: unknown) {
      await client.query("ROLLBACK").catch(() => undefined);

      console.error(
        "Unable to revoke user API key:",
        error instanceof Error ? error.message : "Unknown error",
      );

      res.status(503).json({
        error: "Unable to revoke API key.",
      });
    } finally {
      client.release();
    }
  },
);

const internalMcpPorts: Record<string, string> = {
  "demo-mcp": "9000",
  "woocommerce-mcp": "9100",
  "inventory-mcp": "9200",
};

const createServerSchema = z.object({
  name: z.string().trim().min(1).max(100),
  endpointUrl: z.string().url().refine(
    (value) => {
      try {
        const url = new URL(value);

        if (url.protocol === "https:") {
          return true;
        }

        if (url.protocol !== "http:") {
          return false;
        }

        // Allow HTTP for local development.
        if (["localhost", "127.0.0.1"].includes(url.hostname)) {
          return true;
        }

        // Allow HTTP only for known internal MCP services.
        return (
          internalMcpPorts[url.hostname] === url.port &&
          url.pathname === "/mcp" &&
          url.username === "" &&
          url.password === "" &&
          url.search === "" &&
          url.hash === ""
        );
      } catch {
        return false;
      }
    },
    "Use HTTPS, localhost HTTP for development, or approved internal MCP service URLs",
  ),
  timeoutMs: z.number().int().min(100).max(120000).default(10000),
});

protectedRouter.get(
  "/servers",
  authenticateApiKey,
  requireAdmin,
  async (_req, res) => {
    try {
      const result = await pool.query(
        `SELECT id, name, transport, endpoint_url,
                is_enabled, timeout_ms, created_by,
                created_at, updated_at
         FROM upstream_servers
         ORDER BY created_at DESC`,
      );

      res.json({ servers: result.rows });
    } catch {
      res.status(503).json({
        error: "Unable to list upstream servers",
      });
    }
  },
);

protectedRouter.post(
  "/servers",
  authenticateApiKey,
  requireAdmin,
  async (req, res) => {
    const parsed = createServerSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid upstream server configuration",
        details: parsed.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      });
      return;
    }

    const auth = (req as AuthenticatedRequest).auth!;
    let client;

    try {
      client = await pool.connect();
      await client.query("BEGIN");

      const result = await client.query(
        `INSERT INTO upstream_servers
           (name, endpoint_url, timeout_ms, created_by)
         VALUES ($1, $2, $3, $4)
         RETURNING id, name, transport, endpoint_url,
                   is_enabled, timeout_ms, created_at`,
        [
          parsed.data.name,
          parsed.data.endpointUrl,
          parsed.data.timeoutMs,
          auth.userId,
        ],
      );

      const server = result.rows[0];

      await client.query(
        `INSERT INTO audit_logs
           (user_id, api_key_id, action, resource_type,
            resource_id, outcome, request_id, details)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
        [
          auth.userId,
          auth.apiKeyId,
          "upstream_server.create",
          "upstream_server",
          server.id,
          "success",
          req.header("x-request-id") ?? null,
          JSON.stringify({ name: server.name }),
        ],
      );

      await client.query("COMMIT");
      res.status(201).json({ server });
    } catch {
      if (client) {
        await client.query("ROLLBACK").catch(() => undefined);
      }

      res.status(503).json({
        error: "Unable to register upstream server",
      });
    } finally {
      client?.release();
    }
  },
);

type McpAuditOutcome = "success" | "failure" | "denied";

async function writeMcpAudit(
  req: AuthenticatedRequest,
  serverId: string,
  outcome: McpAuditOutcome,
  details: Record<string, unknown> = {},
): Promise<void> {
  const auth = req.auth;
  if (!auth) return;

  try {
    await pool.query(
      `INSERT INTO audit_logs
         (user_id, api_key_id, action, resource_type,
          resource_id, outcome, request_id, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
      [
        auth.userId,
        auth.apiKeyId,
        "mcp.request",
        "upstream_server",
        serverId,
        outcome,
        req.header("x-request-id")?.slice(0, 200) ?? null,
        JSON.stringify(details),
      ],
    );
  } catch (error: unknown) {
    console.error(
      "Failed to write MCP audit record:",
      error instanceof Error ? error.message : "Unknown error",
    );
  }
}

protectedRouter.post(
  "/servers/:id/mcp",
  authenticateApiKey,
  async (req, res) => {
    const authReq = req as AuthenticatedRequest;
    const serverId = req.params.id;

    if (typeof serverId !== "string" || !UUID_PATTERN.test(serverId)) {
      res.status(400).json({ error: "Invalid upstream server ID" });
      return;
    }

    if (!req.is("application/json")) {
      await writeMcpAudit(authReq, serverId, "denied", {
        reason: "unsupported_content_type",
      });

      res.status(415).json({
        error: "Content-Type must be application/json",
      });
      return;
    }

    if (
      req.body === null ||
      typeof req.body !== "object" ||
      Array.isArray(req.body)
    ) {
      await writeMcpAudit(authReq, serverId, "denied", {
        reason: "invalid_request_body",
      });

      res.status(400).json({ error: "Invalid MCP request body" });
      return;
    }

    const rpcMethod =
      typeof req.body.method === "string"
        ? req.body.method.slice(0, 100)
        : "unknown";

    let server: {
      id: string;
      name: string;
      endpoint_url: string;
      is_enabled: boolean;
      timeout_ms: number;
    };

    try {
      const result = await pool.query(
        `SELECT id, name, endpoint_url, is_enabled, timeout_ms
         FROM upstream_servers
         WHERE id = $1`,
        [serverId],
      );

      if (result.rowCount !== 1) {
        await writeMcpAudit(authReq, serverId, "failure", {
          method: rpcMethod,
          reason: "server_not_found",
        });

        res.status(404).json({ error: "Upstream server not found" });
        return;
      }

      server = result.rows[0];
    } catch {
      await writeMcpAudit(authReq, serverId, "failure", {
        method: rpcMethod,
        reason: "configuration_lookup_failed",
      });

      res.status(503).json({
        error: "Unable to retrieve upstream server configuration",
      });
      return;
    }

    if (!server.is_enabled) {
      await writeMcpAudit(authReq, server.id, "denied", {
        method: rpcMethod,
        reason: "server_disabled",
      });

      res.status(409).json({ error: "Upstream server is disabled" });
      return;
    }

    const incomingAccept = req.header("accept") ?? "";
    const accept =
      incomingAccept.includes("application/json") &&
      incomingAccept.includes("text/event-stream")
        ? incomingAccept
        : "application/json, text/event-stream";

    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept,
    };

    for (const header of [
      "mcp-protocol-version",
      "mcp-session-id",
      "last-event-id",
    ]) {
      const value = req.header(header);
      if (value) headers[header] = value;
    }

    const controller = new AbortController();
    const startedAt = Date.now();
    const timeout = setTimeout(
      () => controller.abort(),
      server.timeout_ms,
    );

    res.on("close", () => {
      if (!res.writableEnded) controller.abort();
    });

    try {
      const upstreamResponse = await fetch(server.endpoint_url, {
        method: "POST",
        headers,
        body: JSON.stringify(req.body),
        signal: controller.signal,
        redirect: "error",
      });

      res.status(upstreamResponse.status);

      for (const header of [
        "content-type",
        "cache-control",
        "mcp-protocol-version",
        "mcp-session-id",
        "last-event-id",
        "retry-after",
      ]) {
        const value = upstreamResponse.headers.get(header);
        if (value !== null) res.setHeader(header, value);
      }

      const outcome: McpAuditOutcome = upstreamResponse.ok
        ? "success"
        : "failure";

      if (!upstreamResponse.body) {
        await writeMcpAudit(authReq, server.id, outcome, {
          method: rpcMethod,
          upstreamStatus: upstreamResponse.status,
          durationMs: Date.now() - startedAt,
        });

        res.end();
        return;
      }

      await pipeline(
        Readable.fromWeb(
          upstreamResponse.body as import("node:stream/web").ReadableStream,
        ),
        res,
      );

      await writeMcpAudit(authReq, server.id, outcome, {
        method: rpcMethod,
        upstreamStatus: upstreamResponse.status,
        durationMs: Date.now() - startedAt,
      });
    } catch (error: unknown) {
      await writeMcpAudit(authReq, server.id, "failure", {
        method: rpcMethod,
        reason: controller.signal.aborted
          ? "timeout_or_cancelled"
          : "upstream_request_failed",
        durationMs: Date.now() - startedAt,
      });

      if (res.destroyed) return;

      if (res.headersSent) {
        res.end();
        return;
      }

      if (controller.signal.aborted) {
        res.status(504).json({
          error: "Upstream MCP request timed out or was cancelled",
        });
        return;
      }

      console.error(
        "MCP upstream request failed:",
        error instanceof Error ? error.message : "Unknown error",
      );

      res.status(502).json({
        error: "Upstream MCP server unavailable",
      });
    } finally {
      clearTimeout(timeout);
    }
  },
);

protectedRouter.delete(
  "/servers/:id",
  authenticateApiKey,
  requireAdmin,
  async (req, res) => {
    const serverId = req.params.id;

    if (typeof serverId !== "string" || !UUID_PATTERN.test(serverId)) {
      res.status(400).json({ error: "Invalid upstream server ID" });
      return;
    }

    const auth = (req as AuthenticatedRequest).auth!;
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const result = await client.query(
        `DELETE FROM upstream_servers
         WHERE id = $1
         RETURNING id, name`,
        [serverId],
      );

      if (result.rowCount !== 1) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "Upstream server not found" });
        return;
      }

      const server = result.rows[0];

      await client.query(
        `INSERT INTO audit_logs
           (user_id, api_key_id, action, resource_type,
            resource_id, outcome, request_id, details)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
        [
          auth.userId,
          auth.apiKeyId,
          "upstream_server.delete",
          "upstream_server",
          server.id,
          "success",
          req.header("x-request-id") ?? null,
          JSON.stringify({ name: server.name }),
        ],
      );

      await client.query("COMMIT");

      res.json({
        message: "Upstream server deleted successfully",
        server: {
          id: server.id,
          name: server.name,
        },
      });
    } catch {
      await client.query("ROLLBACK").catch(() => undefined);
      res.status(503).json({
        error: "Unable to delete upstream server",
      });
    } finally {
      client.release();
    }
  },
);

const serverStatusSchema = z.object({
  isEnabled: z.boolean(),
});

protectedRouter.patch(
  "/servers/:id/status",
  authenticateApiKey,
  requireAdmin,
  async (req, res) => {
    const serverId = req.params.id;

    if (typeof serverId !== "string" || !UUID_PATTERN.test(serverId)) {
      res.status(400).json({ error: "Invalid upstream server ID" });
      return;
    }

    const parsed = serverStatusSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid server status",
        details: parsed.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      });
      return;
    }

    const auth = (req as AuthenticatedRequest).auth!;
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const result = await client.query(
        `UPDATE upstream_servers
         SET is_enabled = $1, updated_at = NOW()
         WHERE id = $2
         RETURNING id, name, is_enabled, updated_at`,
        [parsed.data.isEnabled, serverId],
      );

      if (result.rowCount !== 1) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "Upstream server not found" });
        return;
      }

      const server = result.rows[0];

      await client.query(
        `INSERT INTO audit_logs
           (user_id, api_key_id, action, resource_type,
            resource_id, outcome, request_id, details)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
        [
          auth.userId,
          auth.apiKeyId,
          parsed.data.isEnabled
            ? "upstream_server.enable"
            : "upstream_server.disable",
          "upstream_server",
          server.id,
          "success",
          req.header("x-request-id") ?? null,
          JSON.stringify({
            name: server.name,
            isEnabled: server.is_enabled,
          }),
        ],
      );

      await client.query("COMMIT");

      res.json({ server });
    } catch {
      await client.query("ROLLBACK").catch(() => undefined);

      res.status(503).json({
        error: "Unable to update upstream server status",
      });
    } finally {
      client.release();
    }
  },
);