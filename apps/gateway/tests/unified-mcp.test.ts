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

const TEST_KEY = "urumi_unified_test_key_1234567890123456";
const SERVER_ID = "884cf61a-ce40-44a8-9eae-ec84942de77a";

let upstreamServer:
  | {
      id: string;
      name: string;
      endpoint_url: string;
      timeout_ms: number;
      is_enabled: boolean;
    }
  | undefined;

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetAllMocks();
  upstreamServer = undefined;

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
            rows: [
              {
                api_key_id: "test-api-key-id",
                user_id: "test-user-id",
                email: "unified-test@example.test",
                role: "admin",
              },
            ],
            rowCount: 1,
          };
        }

        return { rows: [], rowCount: 0 };
      }

      if (statement.includes("UPDATE api_keys SET last_used_at")) {
        return { rows: [], rowCount: 1 };
      }

      if (statement.includes("FROM upstream_servers")) {
  if (statement.includes("WHERE id = $1")) {
    const matches =
      upstreamServer && params[0] === upstreamServer.id
        ? [upstreamServer]
        : [];

    return { rows: matches, rowCount: matches.length };
  }

  if (statement.includes("WHERE is_enabled = TRUE")) {
    const matches =
      upstreamServer?.is_enabled ? [upstreamServer] : [];

    return { rows: matches, rowCount: matches.length };
  }

  return { rows: [], rowCount: 0 };
}

      return { rows: [], rowCount: 0 };
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Unified MCP endpoint", () => {
  it("rejects requests without an API key", async () => {
    const response = await request(app)
      .post("/mcp")
      .send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: {
            name: "unified-test-client",
            version: "1.0.0",
          },
        },
      });

    expect(response.status).toBe(401);
  });

  it("initializes an authenticated MCP client with no upstream servers", async () => {
    const response = await request(app)
      .post("/mcp")
      .set("Authorization", `Bearer ${TEST_KEY}`)
      .set("Accept", "application/json, text/event-stream")
      .send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: {
            name: "unified-test-client",
            version: "1.0.0",
          },
        },
      });

    const payload = response.text || JSON.stringify(response.body);

    expect(response.status).toBe(200);
    expect(payload).toContain("urumi-unified-mcp-gateway");
  });
  it("exposes discovered upstream tools through the unified endpoint", async () => {
  upstreamServer = {
    id: SERVER_ID,
    name: "Test Inventory",
    endpoint_url: "http://localhost:9200/mcp",
    timeout_ms: 10000,
    is_enabled: true,
  };

  fetchMock.mockImplementation(
    async (input: URL | RequestInfo, init?: RequestInit) => {
      const rawBody =
        typeof init?.body === "string"
          ? init.body
          : input instanceof Request
            ? await input.clone().text()
            : "{}";

      const message = JSON.parse(rawBody) as {
        id?: string | number;
        method?: string;
        params?: { protocolVersion?: string };
      };

      if (message.method === "notifications/initialized") {
        return new Response(null, { status: 202 });
      }

      const protocolVersion =
        message.params?.protocolVersion ?? "2025-03-26";

      let result: unknown;

      if (message.method === "initialize") {
        result = {
          protocolVersion,
          capabilities: { tools: {} },
          serverInfo: {
            name: "test-inventory",
            version: "1.0.0",
          },
        };
      } else if (message.method === "tools/list") {
        result = {
          tools: [
            {
              name: "get_stock_level",
              description: "Get stock level for a SKU",
              inputSchema: {
                type: "object",
                properties: {
                  sku: { type: "string" },
                },
                required: ["sku"],
              },
            },
          ],
        };
      } else {
        return Response.json(
          {
            jsonrpc: "2.0",
            id: message.id ?? null,
            error: {
              code: -32601,
              message: "Method not found",
            },
          },
          { status: 200 },
        );
      }

      return Response.json(
        {
          jsonrpc: "2.0",
          id: message.id,
          result,
        },
        {
          status: 200,
          headers: {
            "MCP-Protocol-Version": protocolVersion,
          },
        },
      );
    },
  );

  const response = await request(app)
    .post("/mcp")
    .set("Authorization", `Bearer ${TEST_KEY}`)
    .set("Accept", "application/json, text/event-stream")
    .set("MCP-Protocol-Version", "2025-03-26")
    .send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });

  expect(response.status).toBe(200);
  expect(response.text).toContain(
    "test_inventory_884cf61a__get_stock_level",
  );
  expect(response.text).toContain("Get stock level for a SKU");
});
it("forwards tool calls to the correct upstream and audits the result", async () => {
  upstreamServer = {
    id: SERVER_ID,
    name: "Test Inventory",
    endpoint_url: "http://localhost:9200/mcp",
    timeout_ms: 10000,
    is_enabled: true,
  };

  const receivedToolArguments: Array<Record<string, unknown>> = [];

  fetchMock.mockImplementation(
    async (input: URL | RequestInfo, init?: RequestInit) => {
      const rawBody =
        typeof init?.body === "string"
          ? init.body
          : input instanceof Request
            ? await input.clone().text()
            : "{}";

      const message = JSON.parse(rawBody) as {
        id?: string | number;
        method?: string;
        params?: {
          protocolVersion?: string;
          name?: string;
          arguments?: Record<string, unknown>;
        };
      };

      if (message.method === "notifications/initialized") {
        return new Response(null, { status: 202 });
      }

      const protocolVersion =
        message.params?.protocolVersion ?? "2025-03-26";

      let result: unknown;

      if (message.method === "initialize") {
        result = {
          protocolVersion,
          capabilities: { tools: {} },
          serverInfo: {
            name: "test-inventory",
            version: "1.0.0",
          },
        };
      } else if (message.method === "tools/list") {
        result = {
          tools: [
            {
              name: "get_stock_level",
              description: "Get stock level for a SKU",
              inputSchema: {
                type: "object",
                properties: {
                  sku: { type: "string" },
                },
                required: ["sku"],
              },
            },
          ],
        };
      } else if (message.method === "tools/call") {
        receivedToolArguments.push(message.params?.arguments ?? {});

        result = {
          content: [
            {
              type: "text",
              text: "Stock for INV-1002: 7 units",
            },
          ],
          isError: false,
        };
      } else {
        return Response.json(
          {
            jsonrpc: "2.0",
            id: message.id ?? null,
            error: {
              code: -32601,
              message: "Method not found",
            },
          },
          { status: 200 },
        );
      }

      return Response.json(
        {
          jsonrpc: "2.0",
          id: message.id,
          result,
        },
        {
          status: 200,
          headers: {
            "MCP-Protocol-Version": protocolVersion,
          },
        },
      );
    },
  );

  const response = await request(app)
    .post("/mcp")
    .set("Authorization", `Bearer ${TEST_KEY}`)
    .set("Accept", "application/json, text/event-stream")
    .set("MCP-Protocol-Version", "2025-03-26")
    .send({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "test_inventory_884cf61a__get_stock_level",
        arguments: {
          sku: "INV-1002",
        },
      },
    });

  expect(response.status).toBe(200);
  expect(response.text).toContain("Stock for INV-1002: 7 units");

  expect(receivedToolArguments).toContainEqual({
    sku: "INV-1002",
  });

  expect(dbMocks.query).toHaveBeenCalledWith(
    expect.stringContaining("INSERT INTO audit_logs"),
    expect.arrayContaining([
      "test-user-id",
      "test-api-key-id",
      "mcp.tool_call",
      "upstream_server",
      SERVER_ID,
      "success",
    ]),
  );
});
});