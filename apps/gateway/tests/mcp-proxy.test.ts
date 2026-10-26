
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import request from "supertest";
import { hashApiKey } from "../src/api-keys.js";

const dbMocks = vi.hoisted(() => ({
  query: vi.fn(),
  connect: vi.fn(),
}));

vi.mock("../src/db.js", () => ({
  pool: {
    query: dbMocks.query,
    connect: dbMocks.connect,
  },
}));

import { app } from "../src/app.js";

const TEST_KEY = "urumi_proxy_test_key_12345678901234567890";
const SERVER_ID = "884cf61a-ce40-44a8-9eae-ec84942de77a";

let serverEnabled = true;
let serverExists = true;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetAllMocks();

  serverEnabled = true;
  serverExists = true;

  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);

  dbMocks.query.mockImplementation(
    async (sql: unknown, params: unknown[] = []) => {
      const statement = String(sql);

      if (
        statement.includes("FROM api_keys ak") &&
        statement.includes("JOIN users u")
      ) {
        if (params[0] === hashApiKey(TEST_KEY)) {
          return {
            rows: [{
              api_key_id: "test-api-key-id",
              user_id: "test-user-id",
              email: "proxy-test@example.test",
              role: "admin",
            }],
            rowCount: 1,
          };
        }

        return { rows: [], rowCount: 0 };
      }

      if (statement.includes("UPDATE api_keys SET last_used_at")) {
        return { rows: [], rowCount: 1 };
      }

      if (statement.includes("FROM upstream_servers")) {
        if (!serverExists) {
          return { rows: [], rowCount: 0 };
        }

        return {
          rows: [{
            id: SERVER_ID,
            name: "Demo MCP Server",
            endpoint_url: "http://localhost:9000/mcp",
            is_enabled: serverEnabled,
            timeout_ms: 10000,
          }],
          rowCount: 1,
        };
      }

      return { rows: [], rowCount: 0 };
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MCP forwarding endpoint", () => {
  it("rejects unauthenticated requests", async () => {
    const response = await request(app)
      .post(`/api/servers/${SERVER_ID}/mcp`)
      .send({
        jsonrpc: "2.0",
        id: 1,
        method: "ping",
      });

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards MCP requests and streams the upstream response", async () => {
    const sseBody =
      'event: message\n' +
      'data: {"jsonrpc":"2.0","id":1,"result":{"status":"ok"}}\n\n';

    fetchMock.mockResolvedValue(
      new Response(sseBody, {
        status: 200,
        headers: {
          "content-type": "text/event-stream",
        },
      }),
    );

    const response = await request(app)
      .post(`/api/servers/${SERVER_ID}/mcp`)
      .set("Authorization", `Bearer ${TEST_KEY}`)
      .set("Accept", "application/json, text/event-stream")
      .set("MCP-Protocol-Version", "2025-03-26")
      .send({
        jsonrpc: "2.0",
        id: 1,
        method: "ping",
      });

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain(
      "text/event-stream",
    );
    expect(response.text).toContain('"status":"ok"');

    expect(fetchMock).toHaveBeenCalledOnce();

    const [url, options] = fetchMock.mock.calls[0];

    expect(url).toBe("http://localhost:9000/mcp");
    expect(options.method).toBe("POST");
    expect(options.headers["mcp-protocol-version"]).toBe("2025-03-26");
    expect(options.headers.authorization).toBeUndefined();

    // Verify that a successful upstream request is audited.
    await vi.waitFor(() => {
      expect(dbMocks.query).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO audit_logs"),
        expect.arrayContaining([
          "test-user-id",
          "test-api-key-id",
          "mcp.request",
          "upstream_server",
          SERVER_ID,
          "success",
        ]),
      );
    });
  });

  it("rejects requests to a disabled server", async () => {
    serverEnabled = false;

    const response = await request(app)
      .post(`/api/servers/${SERVER_ID}/mcp`)
      .set("Authorization", `Bearer ${TEST_KEY}`)
      .send({
        jsonrpc: "2.0",
        id: 1,
        method: "ping",
      });

    expect(response.status).toBe(409);
    expect(response.body.error).toBe("Upstream server is disabled");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the upstream server does not exist", async () => {
    serverExists = false;

    const response = await request(app)
      .post(`/api/servers/${SERVER_ID}/mcp`)
      .set("Authorization", `Bearer ${TEST_KEY}`)
      .send({
        jsonrpc: "2.0",
        id: 1,
        method: "ping",
      });

    expect(response.status).toBe(404);
    expect(response.body.error).toBe("Upstream server not found");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 502 when the upstream server is unavailable", async () => {
    fetchMock.mockRejectedValue(new Error("Connection refused"));

    const response = await request(app)
      .post(`/api/servers/${SERVER_ID}/mcp`)
      .set("Authorization", `Bearer ${TEST_KEY}`)
      .send({
        jsonrpc: "2.0",
        id: 1,
        method: "ping",
      });

    expect(response.status).toBe(502);
    expect(response.body.error).toBe("Upstream MCP server unavailable");

    // Verify that the upstream failure is audited.
    expect(dbMocks.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO audit_logs"),
      expect.arrayContaining([
        "test-user-id",
        "test-api-key-id",
        "mcp.request",
        "upstream_server",
        SERVER_ID,
        "failure",
      ]),
    );
  });
});
