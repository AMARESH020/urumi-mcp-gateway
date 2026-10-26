
import express, { type Request, type Response } from "express";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

export const app = express();

app.use(express.json({ limit: "1mb" }));

type InventoryItem = {
  sku: string;
  name: string;
  category: string;
  quantity: number;
  reorderLevel: number;
  location: string;
};

// Development fixture only. These values are not live stock records.
const SAMPLE_INVENTORY: InventoryItem[] = [
  {
    sku: "INV-1001",
    name: "Wireless Mouse",
    category: "Accessories",
    quantity: 42,
    reorderLevel: 10,
    location: "Bengaluru Warehouse",
  },
  {
    sku: "INV-1002",
    name: "USB-C Hub",
    category: "Accessories",
    quantity: 7,
    reorderLevel: 12,
    location: "Bengaluru Warehouse",
  },
  {
    sku: "INV-1003",
    name: "Laptop Stand",
    category: "Accessories",
    quantity: 0,
    reorderLevel: 8,
    location: "Mysuru Warehouse",
  },
  {
    sku: "INV-2001",
    name: "Mechanical Keyboard",
    category: "Peripherals",
    quantity: 25,
    reorderLevel: 10,
    location: "Mysuru Warehouse",
  },
];

function stockStatus(item: InventoryItem): string {
  if (item.quantity === 0) return "out_of_stock";
  if (item.quantity <= item.reorderLevel) return "low_stock";
  return "in_stock";
}

function formatItem(item: InventoryItem) {
  return {
    sku: item.sku,
    name: item.name,
    category: item.category,
    quantity: item.quantity,
    reorderLevel: item.reorderLevel,
    location: item.location,
    status: stockStatus(item),
    dataSource: "sample",
  };
}

function successResult(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

function errorResult(message: string) {
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: message,
      },
    ],
  };
}

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "urumi-inventory-mcp",
    version: "1.0.0",
  });

  server.registerTool(
    "search_inventory",
    {
      description:
        "Search the built-in sample inventory by SKU, item name, " +
        "or category. Results are sample data, not live stock records.",
      inputSchema: {
        query: z.string().trim().min(1).max(100),
      },
    },
    async ({ query }) => {
      const normalized = query.toLowerCase();

      const matches = SAMPLE_INVENTORY.filter(
        (item) =>
          item.sku.toLowerCase().includes(normalized) ||
          item.name.toLowerCase().includes(normalized) ||
          item.category.toLowerCase().includes(normalized),
      );

      return successResult({
        dataSource: "sample",
        items: matches.map(formatItem),
        count: matches.length,
      });
    },
  );

  server.registerTool(
    "get_stock_level",
    {
      description:
        "Get the sample stock quantity and stock status for a SKU. " +
        "This tool does not query a live inventory system.",
      inputSchema: {
        sku: z.string().trim().min(1).max(30),
      },
    },
    async ({ sku }) => {
      const normalizedSku = sku.toUpperCase();

      const item = SAMPLE_INVENTORY.find(
        (candidate) => candidate.sku === normalizedSku,
      );

      if (!item) {
        return errorResult(
          `No sample inventory item found for SKU ${normalizedSku}.`,
        );
      }

      return successResult({
        dataSource: "sample",
        item: formatItem(item),
      });
    },
  );

  server.registerTool(
    "list_inventory",
    {
      description:
        "List sample inventory items, optionally filtered by category. " +
        "Supports pagination and does not access a live inventory system.",
      inputSchema: {
        category: z.string().trim().min(1).max(60).optional(),
        page: z.number().int().min(1).max(100).default(1),
        perPage: z.number().int().min(1).max(25).default(10),
      },
    },
    async ({ category, page, perPage }) => {
      const filtered = category
        ? SAMPLE_INVENTORY.filter(
            (item) =>
              item.category.toLowerCase() === category.toLowerCase(),
          )
        : SAMPLE_INVENTORY;

      const start = (page - 1) * perPage;
      const items = filtered.slice(start, start + perPage);

      return successResult({
        dataSource: "sample",
        items: items.map(formatItem),
        page,
        perPage,
        total: filtered.length,
      });
    },
  );

  return server;
}

app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "urumi-inventory-mcp",
    dataSource: "sample",
  });
});

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
      "Inventory MCP request failed:",
      error instanceof Error ? error.message : "Unknown error",
    );

    if (!res.headersSent) {
      res.status(500).json({ error: "MCP request failed." });
    }

    void transport.close();
    void server.close();
  }
});

app.get("/mcp", (_req, res) => {
  res.status(405).json({
    error: "GET is not supported by this stateless MCP server.",
  });
});

app.delete("/mcp", (_req, res) => {
  res.status(405).json({
    error: "Session deletion is not supported by this stateless MCP server.",
  });
});

const port = Number.parseInt(
  process.env.INVENTORY_MCP_PORT ?? "9200",
  10,
);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("INVENTORY_MCP_PORT must be a valid TCP port.");
}

// Importing the app during tests must not bind the network port.
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  app.listen(port, "0.0.0.0", () => {
    console.log(`Inventory MCP Server listening on port ${port}`);
  });
}
