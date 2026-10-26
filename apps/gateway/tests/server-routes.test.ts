
import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { hashApiKey } from "../src/api-keys.js";

const dbMocks = vi.hoisted(() => ({
  query: vi.fn(
    async (
      _sql: unknown,
      _params?: unknown[],
    ) => ({
      rows: [] as Record<string, unknown>[],
      rowCount: 0,
    }),
  ),
  connect: vi.fn(),
  clientQuery: vi.fn(
    async (
      _sql: unknown,
      _params?: unknown[],
    ) => ({
      rows: [] as Record<string, unknown>[],
      rowCount: 0,
    }),
  ),
  clientRelease: vi.fn(),
}));

// Mock PostgreSQL for this test file only.
// No queries reach the real database.
vi.mock("../src/db.js", () => ({
  pool: {
    query: dbMocks.query,
    connect: dbMocks.connect,
  },
}));

import { app } from "../src/app.js";

const ADMIN_KEY =
  "urumi_test_admin_key_12345678901234567890";

const MEMBER_KEY =
  "urumi_test_member_key_12345678901234567890";

const SERVER_ID =
  "52a12613-1fad-4489-a93f-ef4434f55867";



describe("Upstream server API security and validation", () => {
  beforeEach(() => {
    vi.resetAllMocks();

    dbMocks.query.mockImplementation(
      async (sql, params = []) => {
        const statement = String(sql);

        if (
  statement.includes("FROM api_keys ak") && statement.includes("JOIN users u")
) {
          const suppliedHash = params[0];

          if (suppliedHash === hashApiKey(ADMIN_KEY)) {
            return {
              rows: [{
                api_key_id: "test-admin-key-id",
                user_id: "test-admin-user-id",
                email: "admin@example.test",
                role: "admin",
              }],
              rowCount: 1,
            };
          }

          if (suppliedHash === hashApiKey(MEMBER_KEY)) {
            return {
              rows: [{
                api_key_id: "test-member-key-id",
                user_id: "test-member-user-id",
                email: "member@example.test",
                role: "member",
              }],
              rowCount: 1,
            };
          }

          return { rows: [], rowCount: 0 };
        }

        if (statement.includes("UPDATE api_keys SET last_used_at")) {
          return { rows: [], rowCount: 1 };
        }
                if (statement.includes("FROM audit_logs")) {
          return {
            rows: [
              {
                id: 5,
                action: "mcp.tool_call",
                resource_type: "upstream_server",
                resource_id: SERVER_ID,
                outcome: "success",
                request_id: null,
                server_name: "Inventory MCP Server",
                exposed_tool_name:
                  "inventory_mcp_server_test__search_inventory",
                upstream_tool_name: "search_inventory",
                duration_ms: "29",
                action_tool_name: null,
                action_status: null,
                resource_name: null,
                is_enabled: null,
                created_at: "2026-10-21T14:14:27.752Z",
              },
            ],
            rowCount: 1,
          };
        }

        return { rows: [], rowCount: 0 };
      },
    );

    dbMocks.clientQuery.mockImplementation(
      async (sql, params = []) => {
        const statement = String(sql);

        if (statement.includes("UPDATE upstream_servers")) {
          return {
            rows: [{
              id: SERVER_ID,
              name: "Demo MCP Server",
              is_enabled: params[0],
              updated_at: "2026-10-15T00:00:00.000Z",
            }],
            rowCount: 1,
          };
        }

        return { rows: [], rowCount: 1 };
      },
    );

    dbMocks.connect.mockResolvedValue({
      query: dbMocks.clientQuery,
      release: dbMocks.clientRelease,
    });
  });

  it("rejects unauthenticated admin requests with 401", async () => {
    const response = await request(app).get("/api/servers");

    expect(response.status).toBe(401);
    expect(response.body.error).toBeDefined();
    expect(dbMocks.query).not.toHaveBeenCalled();
  });

  it("rejects members attempting to list servers with 403", async () => {
    const response = await request(app)
      .get("/api/servers")
      .set("Authorization", `Bearer ${MEMBER_KEY}`);

    expect(response.status).toBe(403);
    expect(response.body.error).toBe(
      "Administrator privileges required",
    );
  });

  it("rejects an invalid server ID with 400", async () => {
    const response = await request(app)
      .patch("/api/servers/not-a-uuid/status")
      .set("Authorization", `Bearer ${ADMIN_KEY}`)
      .send({ isEnabled: false });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe(
      "Invalid upstream server ID",
    );
    expect(dbMocks.connect).not.toHaveBeenCalled();
  });

  it("rejects a non-boolean server status with 400", async () => {
    const response = await request(app)
      .patch(`/api/servers/${SERVER_ID}/status`)
      .set("Authorization", `Bearer ${ADMIN_KEY}`)
      .send({ isEnabled: "false" });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Invalid server status");
    expect(dbMocks.connect).not.toHaveBeenCalled();
  });

  it("updates server status and writes an audit record", async () => {
    const response = await request(app)
      .patch(`/api/servers/${SERVER_ID}/status`)
      .set("Authorization", `Bearer ${ADMIN_KEY}`)
      .send({ isEnabled: false });

    expect(response.status).toBe(200);
    expect(response.body.server.is_enabled).toBe(false);

    expect(dbMocks.clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO audit_logs"),
      expect.arrayContaining([
        "test-admin-user-id",
        "test-admin-key-id",
        "upstream_server.disable",
        "upstream_server",
        SERVER_ID,
        "success",
      ]),
    );

    expect(dbMocks.clientQuery).toHaveBeenCalledWith(
      "COMMIT",
    );

    expect(dbMocks.clientRelease).toHaveBeenCalled();
  });
    it("requires authentication to read audit logs", async () => {
    const response = await request(app).get("/api/audit-logs");

    expect(response.status).toBe(401);
    expect(response.body.error).toBeDefined();

    expect(
      dbMocks.query.mock.calls.some(([sql]) =>
        String(sql).includes("FROM audit_logs"),
      ),
    ).toBe(false);
  });

  it("allows admins to read audit logs", async () => {
    const response = await request(app)
      .get("/api/audit-logs")
      .set("Authorization", `Bearer ${ADMIN_KEY}`);

    expect(response.status).toBe(200);
    expect(response.body.events).toHaveLength(1);
    expect(response.body.events[0]).toMatchObject({
      action: "mcp.tool_call",
      resource_type: "upstream_server",
      outcome: "success",
      server_name: "Inventory MCP Server",
      upstream_tool_name: "search_inventory",
      duration_ms: "29",
    });

    // The endpoint must not expose the full audit JSON.
    expect(response.body.events[0]).not.toHaveProperty("details");

    expect(dbMocks.query).toHaveBeenCalledWith(
      expect.stringContaining("FROM audit_logs"),
      [true, "test-admin-user-id", 50],
    );
  });

  it("restricts member audit queries to the authenticated user", async () => {
    const response = await request(app)
      .get("/api/audit-logs?limit=10")
      .set("Authorization", `Bearer ${MEMBER_KEY}`);

    expect(response.status).toBe(200);
    expect(response.body.events).toHaveLength(1);

    expect(dbMocks.query).toHaveBeenCalledWith(
      expect.stringContaining("WHERE ($1::boolean OR user_id = $2)"),
      [false, "test-member-user-id", 10],
    );
  });

  it("rejects invalid audit-log limits", async () => {
    const response = await request(app)
      .get("/api/audit-logs?limit=101")
      .set("Authorization", `Bearer ${ADMIN_KEY}`);

    expect(response.status).toBe(400);
    expect(response.body.error).toBe(
      "Limit must be an integer between 1 and 100.",
    );

    expect(
      dbMocks.query.mock.calls.some(([sql]) =>
        String(sql).includes("FROM audit_logs"),
      ),
    ).toBe(false);
  });
});
