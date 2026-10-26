import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import request from "supertest";

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
}));

vi.mock("../src/db.js", () => ({
  pool: {
    query: queryMock,
  },
}));

import { app } from "../src/app.js";

const authorization = "Bearer urumi_test_key_123";
const originalOpenAiKey = process.env.OPENAI_API_KEY;

const actionId = "11111111-1111-4111-8111-111111111111";
const toolName = "woo__create_product";

const storedArguments = {
  name: "Test draft product",
  regularPrice: "10.00",
};

const pendingAction = {
  id: actionId,
  tool_name: toolName,
  action_arguments: storedArguments,
};

function authDatabaseResponse(sql: string) {
  if (sql.includes("FROM api_keys")) {
    return {
      rowCount: 1,
      rows: [
        {
          api_key_id: "test-key-id",
          user_id: "test-user-id",
          email: "test@example.com",
          role: "admin",
        },
      ],
    };
  }

  return null;
}

describe("POST /api/chat", () => {
  beforeEach(() => {
    queryMock.mockReset();

    queryMock.mockImplementation(async (sql: string) => {
      const authResult = authDatabaseResponse(sql);

      if (authResult) {
        return authResult;
      }

      return { rowCount: 0, rows: [] };
    });

    // Never make a real OpenAI API call in these tests.
    process.env.OPENAI_API_KEY = "";
  });

  afterEach(() => {
    vi.unstubAllGlobals();

    if (originalOpenAiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalOpenAiKey;
    }
  });

  it("rejects requests without an API key", async () => {
    const response = await request(app)
      .post("/api/chat")
      .send({ message: "Hello" });

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("Missing or invalid bearer token");
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("rejects an empty message", async () => {
    const response = await request(app)
      .post("/api/chat")
      .set("Authorization", authorization)
      .send({ message: "   " });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Invalid chat request.");
  });

  it("rejects a missing message", async () => {
    const response = await request(app)
      .post("/api/chat")
      .set("Authorization", authorization)
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Invalid chat request.");
  });

  it("rejects chat history exceeding the limit", async () => {
    const history = Array.from({ length: 13 }, () => ({
      role: "user",
      content: "Previous message",
    }));

    const response = await request(app)
      .post("/api/chat")
      .set("Authorization", authorization)
      .send({ message: "Hello", history });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Invalid chat request.");
  });

  it("returns 503 when OpenAI is not configured", async () => {
    const response = await request(app)
      .post("/api/chat")
      .set("Authorization", authorization)
      .send({ message: "Hello" });

    expect(response.status).toBe(503);
    expect(response.body.error).toContain(
      "AI chat is not configured on the server",
    );
  });
});

describe("Chat action confirmation", () => {
  beforeEach(() => {
    queryMock.mockReset();

    queryMock.mockImplementation(async (sql: string) => {
      const authResult = authDatabaseResponse(sql);

      if (authResult) {
        return authResult;
      }

      return { rowCount: 0, rows: [] };
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects an invalid action ID", async () => {
    const response = await request(app)
      .post("/api/chat/actions/not-a-uuid/confirm")
      .set("Authorization", authorization)
      .send();

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Invalid action ID.");
  });

  it("rejects confirmation when no pending action belongs to the caller", async () => {
    const response = await request(app)
      .post(`/api/chat/actions/${actionId}/confirm`)
      .set("Authorization", authorization)
      .send();

    expect(response.status).toBe(409);

    const claimCall = queryMock.mock.calls.find(
      (call) =>
        String(call[0]).includes("SET status = 'executing'"),
    );

    expect(claimCall).toBeDefined();
    expect(claimCall?.[1]).toEqual([
      actionId,
      "test-user-id",
      "test-key-id",
    ]);
  });

  it("rejects and expires an expired pending action", async () => {
    queryMock.mockImplementation(async (sql: string) => {
      const authResult = authDatabaseResponse(sql);

      if (authResult) {
        return authResult;
      }

      if (sql.includes("SET status = 'expired'")) {
        return { rowCount: 1, rows: [] };
      }

      return { rowCount: 0, rows: [] };
    });

    const response = await request(app)
      .post(`/api/chat/actions/${actionId}/confirm`)
      .set("Authorization", authorization)
      .send();

    expect(response.status).toBe(409);
    expect(response.body.error).toContain("expired");

    expect(
      queryMock.mock.calls.some(
        (call) => String(call[0]).includes("SET status = 'expired'"),
      ),
    ).toBe(true);
  });

  it("rejects cancellation when no pending action belongs to the caller", async () => {
    const response = await request(app)
      .post(`/api/chat/actions/${actionId}/cancel`)
      .set("Authorization", authorization)
      .send();

    expect(response.status).toBe(409);

    const cancellationCall = queryMock.mock.calls.find(
      (call) =>
        String(call[0]).includes("SET status = 'cancelled'"),
    );

    expect(cancellationCall).toBeDefined();
    expect(cancellationCall?.[1]).toEqual([
      actionId,
      "test-user-id",
      "test-key-id",
    ]);
  });

  it("cancels a pending action and records an audit event", async () => {
    queryMock.mockImplementation(async (sql: string) => {
      const authResult = authDatabaseResponse(sql);

      if (authResult) {
        return authResult;
      }

      if (sql.includes("SET status = 'cancelled'")) {
        return {
          rowCount: 1,
          rows: [{ id: actionId, tool_name: toolName }],
        };
      }

      return { rowCount: 1, rows: [] };
    });

    const response = await request(app)
      .post(`/api/chat/actions/${actionId}/cancel`)
      .set("Authorization", authorization)
      .send();

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("cancelled");

    expect(
      queryMock.mock.calls.some(
        (call) =>
          String(call[0]).includes("INSERT INTO audit_logs") &&
          String(call[1]?.[2]) === "chat.action_cancel",
      ),
    ).toBe(true);
  });

  it("executes the stored arguments once and rejects a repeated confirmation", async () => {
    let simulatedStatus = "pending";
    const mcpRequests: Array<{
      method: string;
      params?: {
        name?: string;
        arguments?: Record<string, unknown>;
      };
    }> = [];

    queryMock.mockImplementation(async (sql: string) => {
      const authResult = authDatabaseResponse(sql);

      if (authResult) {
        return authResult;
      }

      if (sql.includes("SET status = 'executing'")) {
        if (simulatedStatus !== "pending") {
          return { rowCount: 0, rows: [] };
        }

        simulatedStatus = "executing";

        return {
          rowCount: 1,
          rows: [pendingAction],
        };
      }

      if (sql.includes("SET status = 'succeeded'")) {
        simulatedStatus = "succeeded";

        return {
          rowCount: 1,
          rows: [{ id: actionId }],
        };
      }

      if (sql.includes("SET status = 'failed'")) {
        simulatedStatus = "failed";
      }

      return { rowCount: 1, rows: [] };
    });

    const fakeFetch = vi.fn(
      async (_input: unknown, init?: RequestInit) => {
        const rpc = JSON.parse(String(init?.body)) as {
          method: string;
          params?: {
            name?: string;
            arguments?: Record<string, unknown>;
          };
        };

        mcpRequests.push(rpc);

        if (rpc.method === "tools/list") {
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: 400,
              result: {
                tools: [
                  {
                    name: toolName,
                    description: "Create a product",
                    inputSchema: {
                      type: "object",
                      properties: {
                        name: { type: "string" },
                        regularPrice: { type: "string" },
                      },
                    },
                  },
                ],
              },
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          );
        }

        if (rpc.method === "tools/call") {
          return new Response(
            JSON.stringify({
              jsonrpc: "2.0",
              id: 401,
              result: {
                isError: false,
                content: [{ type: "text", text: "Mock operation completed" }],
              },
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          );
        }

        throw new Error(`Unexpected MCP method: ${rpc.method}`);
      },
    );

    vi.stubGlobal("fetch", fakeFetch);

    // The client-supplied body must not override the stored action.
    const first = await request(app)
      .post(`/api/chat/actions/${actionId}/confirm`)
      .set("Authorization", authorization)
      .send({
        toolName: "unapproved_tool",
        arguments: { name: "Tampered arguments" },
      });

    expect(first.status).toBe(200);
    expect(first.body.status).toBe("succeeded");
    expect(simulatedStatus).toBe("succeeded");

    const toolCall = mcpRequests.find(
      (rpc) => rpc.method === "tools/call",
    );

    expect(toolCall?.params?.name).toBe(toolName);
    expect(toolCall?.params?.arguments).toEqual(storedArguments);

    expect(fakeFetch).toHaveBeenCalledTimes(2);

    const second = await request(app)
      .post(`/api/chat/actions/${actionId}/confirm`)
      .set("Authorization", authorization)
      .send();

    expect(second.status).toBe(409);

    // The repeated confirmation must not call the MCP tool again.
    expect(fakeFetch).toHaveBeenCalledTimes(2);
  });
});