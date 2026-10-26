
import express, { type Request, type Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const app = express();

app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "urumi-demo-mcp",
  });
});

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "urumi-demo-mcp",
    version: "1.0.0",
  });

  server.registerTool(
    "echo",
    {
      description: "Echo a message back to the MCP client.",
      inputSchema: {
        message: z.string().trim().min(1).max(500),
      },
    },
    async ({ message }) => ({
      content: [
        {
          type: "text",
          text: `Demo MCP received: ${message}`,
        },
      ],
    }),
  );

  server.registerTool(
    "get_demo_status",
    {
      description: "Return the current status of the Demo MCP Server.",
      inputSchema: {},
    },
    async () => ({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            status: "ok",
            service: "urumi-demo-mcp",
            timestamp: new Date().toISOString(),
          }),
        },
      ],
    }),
  );

  return server;
}

// Stateless Streamable HTTP: each POST gets a fresh server and transport.
app.post("/mcp", async (req: Request, res: Response) => {
  const server = createMcpServer();

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);

    res.on("close", () => {
      void transport.close();
      void server.close();
    });
  } catch (error: unknown) {
    console.error(
      "Demo MCP request failed:",
      error instanceof Error ? error.message : "Unknown error",
    );

    if (!res.headersSent) {
      res.status(500).json({
        error: "MCP request failed",
      });
    }

    void transport.close();
    void server.close();
  }
});

// This server does not provide GET-based event streams or session deletion.
app.get("/mcp", (_req, res) => {
  res.status(405).json({
    error: "GET is not supported by this stateless MCP server",
  });
});

app.delete("/mcp", (_req, res) => {
  res.status(405).json({
    error: "This stateless MCP server does not support session deletion",
  });
});

const port = Number.parseInt(process.env.DEMO_MCP_PORT ?? "9000", 10);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("DEMO_MCP_PORT must be a valid TCP port");
}

app.listen(port, "0.0.0.0", () => {
  console.log(`Demo MCP Server listening on port ${port}`);
});
