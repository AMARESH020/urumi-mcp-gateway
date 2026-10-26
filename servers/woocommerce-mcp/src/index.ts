import { createHmac, randomBytes } from "node:crypto";
import dotenv from "dotenv";
import express, { type Request, type Response } from "express";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

// Load the monorepo root .env in development and compiled execution.
dotenv.config({
  path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env"),
});

export const app = express();

app.use(express.json({ limit: "1mb" }));

const REQUEST_TIMEOUT_MS = 8000;

interface WooProduct {
  id: number;
  name: string;
  slug: string;
  type: string;
  price: string;
  regular_price: string;
  sale_price: string;
  stock_status: string;
  permalink: string;
  on_sale: boolean;
  categories: Array<{
    id: number;
    name: string;
    slug: string;
  }>;
}

interface WooCategory {
  id: number;
  name: string;
  slug: string;
  parent: number;
  count: number;
}

function isWooConfigured(): boolean {
  return Boolean(
    process.env.WOOCOMMERCE_URL?.trim() &&
      process.env.WOOCOMMERCE_CONSUMER_KEY?.trim() &&
      process.env.WOOCOMMERCE_CONSUMER_SECRET?.trim(),
  );
}

function getStoreConfiguration(): {
  baseUrl: URL;
  oauthBaseUrl: URL;
  consumerKey: string;
  consumerSecret: string;
} {
  const rawUrl = process.env.WOOCOMMERCE_URL?.trim();
  const consumerKey = process.env.WOOCOMMERCE_CONSUMER_KEY?.trim();
  const consumerSecret = process.env.WOOCOMMERCE_CONSUMER_SECRET?.trim();

  if (!rawUrl || !consumerKey || !consumerSecret) {
    throw new Error(
      "WooCommerce is not configured. Set WOOCOMMERCE_URL, " +
        "WOOCOMMERCE_CONSUMER_KEY and WOOCOMMERCE_CONSUMER_SECRET " +
        "in the root .env file.",
    );
  }

  let baseUrl: URL;

  try {
    baseUrl = new URL(rawUrl);
  } catch {
    throw new Error("WOOCOMMERCE_URL is not a valid URL.");
  }

  const localHosts = ["localhost", "127.0.0.1", "[::1]"];

const isLocalHttp =
  baseUrl.protocol === "http:" &&
  localHosts.includes(baseUrl.hostname);

const inClusterStoreHosts = [
  "urumi-gateway-store-wordpress",
  "urumi-gateway-store-wordpress.default.svc.cluster.local",
];

const isInClusterStoreHttp =
  baseUrl.protocol === "http:" &&
  inClusterStoreHosts.includes(baseUrl.hostname);

if (baseUrl.protocol !== "https:" && !isLocalHttp && !isInClusterStoreHttp) {
  throw new Error(
    "WooCommerce must use HTTPS, except for localhost development and the approved in-cluster store service.",
  );
}

  if (baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) {
    throw new Error(
      "WOOCOMMERCE_URL must not contain credentials, a query string, or a fragment.",
    );
  }

  baseUrl.pathname = baseUrl.pathname.replace(/\/+$/, "") || "/";
    const rawOAuthUrl =
    process.env.WOOCOMMERCE_OAUTH_URL?.trim() || rawUrl;

  let oauthBaseUrl: URL;

  try {
    oauthBaseUrl = new URL(rawOAuthUrl);
  } catch {
    throw new Error("WOOCOMMERCE_OAUTH_URL is not a valid URL.");
  }

  const allowedOAuthHttpHosts = [
    "localhost",
    "127.0.0.1",
    "[::1]",
    "store.urumi.local",
    "urumi-gateway-store-wordpress",
    "urumi-gateway-store-wordpress.default.svc.cluster.local",
  ];

  if (
    oauthBaseUrl.protocol !== "https:" &&
    !(
      oauthBaseUrl.protocol === "http:" &&
      allowedOAuthHttpHosts.includes(oauthBaseUrl.hostname)
    )
  ) {
    throw new Error(
      "WOOCOMMERCE_OAUTH_URL must use HTTPS or an approved local HTTP hostname.",
    );
  }

  if (
    oauthBaseUrl.username ||
    oauthBaseUrl.password ||
    oauthBaseUrl.search ||
    oauthBaseUrl.hash
  ) {
    throw new Error(
      "WOOCOMMERCE_OAUTH_URL must not contain credentials, a query string, or a fragment.",
    );
  }

  oauthBaseUrl.pathname =
    oauthBaseUrl.pathname.replace(/\/+$/, "") || "/";

  return { baseUrl, oauthBaseUrl, consumerKey, consumerSecret };
}
function oauthPercentEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

async function wooRequest<T>(
  method: "GET" | "POST" | "PUT",
  resourcePath: string,
  query: Record<string, string> = {},
  body?: Record<string, unknown>,
): Promise<T> {
  const config = getStoreConfiguration();
  const storePath = config.baseUrl.pathname.replace(/\/+$/, "");
  const apiUrl = new URL(
    `${storePath}/wp-json/wc/v3${resourcePath}`,
    config.baseUrl.origin,
  );

  for (const [key, value] of Object.entries(query)) {
    apiUrl.searchParams.set(key, value);
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT_MS,
  );

  const headers: Record<string, string> = {
  Accept: "application/json",
};

if (config.baseUrl.protocol === "https:") {
  // Basic authentication is used only over HTTPS.
  headers.Authorization =
    "Basic " +
    Buffer.from(
      `${config.consumerKey}:${config.consumerSecret}`,
      "utf8",
    ).toString("base64");
} else {
  // WooCommerce OAuth 1.0a for the in-cluster HTTP connection.
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: config.consumerKey,
    oauth_nonce: randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA256",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
  };

  const normalizedParams = [
    ...Array.from(apiUrl.searchParams.entries()),
    ...Object.entries(oauthParams),
  ]
    .map(
      ([key, value]) =>
        [oauthPercentEncode(key), oauthPercentEncode(value)] as const,
    )
    .sort((a, b) => {
      if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
      if (a[1] !== b[1]) return a[1] < b[1] ? -1 : 1;
      return 0;
    })
    .map(([key, value]) => `${key}=${value}`)
    .join("&");

  const canonicalPath =
    `${config.oauthBaseUrl.pathname.replace(/\/+$/, "")}` +
    `/wp-json/wc/v3${resourcePath}`;

  const signatureUrl = new URL(
    canonicalPath,
    config.oauthBaseUrl.origin,
  );

  const signatureUrlForSigning =
    `${signatureUrl.origin}${signatureUrl.pathname}`;

  const signatureBaseString = [
    method.toUpperCase(),
    oauthPercentEncode(signatureUrlForSigning),
    oauthPercentEncode(normalizedParams),
  ].join("&");

  const signingKey = `${oauthPercentEncode(config.consumerSecret)}&`;

  const signature = createHmac("sha256", signingKey)
    .update(signatureBaseString)
    .digest("base64");

  for (const [key, value] of Object.entries(oauthParams)) {
    apiUrl.searchParams.set(key, value);
  }

  apiUrl.searchParams.set("oauth_signature", signature);
}

  const options: RequestInit = {
    method,
    headers,
    signal: controller.signal,
    redirect: "error",
  };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(apiUrl, options);

    if (!response.ok) {
      throw new Error(
        `WooCommerce API returned HTTP ${response.status}.`,
      );
    }

    return (await response.json()) as T;
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      error.message.startsWith("WooCommerce API returned")
    ) {
      throw error;
    }

    if (controller.signal.aborted) {
      throw new Error("WooCommerce API request timed out.");
    }

    throw new Error("Unable to connect to the WooCommerce API.");
  } finally {
    clearTimeout(timeout);
  }
}

async function wooGet<T>(
  resourcePath: string,
  query: Record<string, string>,
): Promise<T> {
  return wooRequest<T>("GET", resourcePath, query);
}

function formatProduct(product: WooProduct) {
  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    type: product.type,
    price: product.price,
    regularPrice: product.regular_price,
    salePrice: product.sale_price,
    stockStatus: product.stock_status,
    onSale: product.on_sale,
    permalink: product.permalink,
    categories: (product.categories ?? []).map((category) => ({
      id: category.id,
      name: category.name,
      slug: category.slug,
    })),
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

function errorResult(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : "Unexpected WooCommerce tool error.";

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
    name: "urumi-woocommerce-mcp",
    version: "1.0.0",
  });

  server.registerTool(
    "search_products",
    {
      description:
        "Search WooCommerce products by keyword. Returns product " +
        "identifiers, prices, stock status, links and categories.",
      inputSchema: {
        query: z.string().trim().min(1).max(100),
        page: z.number().int().min(1).max(100).default(1),
        perPage: z.number().int().min(1).max(25).default(10),
      },
    },
    async ({ query, page, perPage }) => {
      try {
        const products = await wooGet<WooProduct[]>("/products", {
          search: query,
          page: String(page),
          per_page: String(perPage),
        });

        return successResult({
          products: products.map(formatProduct),
          page,
          perPage,
        });
      } catch (error: unknown) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "update_order_status",
    {
      description:
        "Update the status of a WooCommerce order by numeric ID. " +
        "Returns the updated status and a limited order summary.",
      inputSchema: {
        id: z.number().int().min(1).max(2147483647),
        status: z.enum([
          "pending",
          "processing",
          "on-hold",
          "completed",
          "cancelled",
          "refunded",
          "failed",
        ]),
      },
    },
    async ({ id, status }) => {
      try {
        const order = await wooRequest<{
          id: number;
          status: string;
          date_modified?: string;
          total: string;
          currency: string;
        }>(
          "PUT",
          `/orders/${id}`,
          {},
          { status },
        );

        return successResult({
          message: "Order status updated successfully.",
          order: {
            id: order.id,
            status: order.status,
            dateModified: order.date_modified ?? null,
            total: order.total,
            currency: order.currency,
          },
        });
      } catch (error: unknown) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "get_order",
    {
      description:
        "Get a WooCommerce order by numeric order ID. Returns order " +
        "status, date, totals, customer ID and line-item summaries. " +
        "Does not return customer contact details or billing addresses.",
      inputSchema: {
        id: z.number().int().min(1).max(2147483647),
      },
    },
    async ({ id }) => {
      try {
        const order = await wooGet<{
          id: number;
          status: string;
          date_created?: string;
          date_modified?: string;
          total: string;
          currency: string;
          customer_id: number;
          line_items?: Array<{
            product_id: number;
            name: string;
            quantity: number;
            total: string;
          }>;
        }>(`/orders/${id}`, {});

        return successResult({
          order: {
            id: order.id,
            status: order.status,
            dateCreated: order.date_created ?? null,
            dateModified: order.date_modified ?? null,
            total: order.total,
            currency: order.currency,
            customerId: order.customer_id,
            lineItems: (order.line_items ?? []).map((item) => ({
              productId: item.product_id,
              name: item.name,
              quantity: item.quantity,
              total: item.total,
            })),
          },
        });
      } catch (error: unknown) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "list_orders",
    {
      description:
        "List WooCommerce orders with pagination and an optional " +
        "status filter. Returns order IDs, dates, totals, statuses, " +
        "and limited line-item summaries without customer contact details.",
      inputSchema: {
        page: z.number().int().min(1).max(100).default(1),
        perPage: z.number().int().min(1).max(25).default(10),
        status: z
          .enum([
            "pending",
            "processing",
            "on-hold",
            "completed",
            "cancelled",
            "refunded",
            "failed",
            "trash",
          ])
          .optional(),
      },
    },
    async ({ page, perPage, status }) => {
      try {
        const query: Record<string, string> = {
          page: String(page),
          per_page: String(perPage),
        };

        if (status !== undefined) {
          query.status = status;
        }

        const orders = await wooGet<
          Array<{
            id: number;
            status: string;
            date_created?: string;
            total: string;
            currency: string;
            customer_id: number;
            line_items?: Array<{
              product_id: number;
              name: string;
              quantity: number;
              total: string;
            }>;
          }>
        >("/orders", query);

        return successResult({
          orders: orders.map((order) => ({
            id: order.id,
            status: order.status,
            dateCreated: order.date_created ?? null,
            total: order.total,
            currency: order.currency,
            customerId: order.customer_id,
            lineItems: (order.line_items ?? []).map((item) => ({
              productId: item.product_id,
              name: item.name,
              quantity: item.quantity,
              total: item.total,
            })),
          })),
          page,
          perPage,
          ...(status !== undefined ? { status } : {}),
        });
      } catch (error: unknown) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "list_products",
    {
      description:
        "List WooCommerce products with pagination and optional " +
        "category or status filters. Returns product identifiers, " +
        "names, prices, stock status, links and categories.",
      inputSchema: {
        page: z.number().int().min(1).max(100).default(1),
        perPage: z.number().int().min(1).max(25).default(10),
        categoryId: z.number().int().min(1).optional(),
        status: z
          .enum(["publish", "draft", "pending", "private"])
          .optional(),
      },
    },
    async ({ page, perPage, categoryId, status }) => {
      try {
        const query: Record<string, string> = {
          page: String(page),
          per_page: String(perPage),
        };

        if (categoryId !== undefined) {
          query.category = String(categoryId);
        }

        if (status !== undefined) {
          query.status = status;
        }

        const products = await wooGet<WooProduct[]>(
          "/products",
          query,
        );

        return successResult({
          products: products.map(formatProduct),
          page,
          perPage,
          ...(categoryId !== undefined ? { categoryId } : {}),
          ...(status !== undefined ? { status } : {}),
        });
      } catch (error: unknown) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "create_product",
    {
      description:
        "Create a simple WooCommerce product. New products default " +
        "to draft status unless another permitted status is specified.",
      inputSchema: {
        name: z.string().trim().min(1).max(120),
        regularPrice: z
          .string()
          .trim()
          .regex(/^\d+(\.\d{1,2})?$/)
          .optional(),
        description: z.string().max(10000).optional(),
        shortDescription: z.string().max(500).optional(),
        sku: z.string().trim().max(100).optional(),
        status: z
          .enum(["draft", "pending", "private", "publish"])
          .default("draft"),
        stockQuantity: z.number().int().min(0).max(1000000).optional(),
        categoryIds: z
          .array(z.number().int().min(1))
          .max(20)
          .optional(),
      },
    },
    async ({
      name,
      regularPrice,
      description,
      shortDescription,
      sku,
      status,
      stockQuantity,
      categoryIds,
    }) => {
      try {
        const payload: Record<string, unknown> = {
          name,
          type: "simple",
          status,
        };

        if (regularPrice !== undefined) {
          payload.regular_price = regularPrice;
        }

        if (description !== undefined) {
          payload.description = description;
        }

        if (shortDescription !== undefined) {
          payload.short_description = shortDescription;
        }

        if (sku !== undefined && sku.length > 0) {
          payload.sku = sku;
        }

        if (stockQuantity !== undefined) {
          payload.manage_stock = true;
          payload.stock_quantity = stockQuantity;
        }

        if (categoryIds !== undefined) {
          payload.categories = categoryIds.map((id) => ({ id }));
        }

        const product = await wooRequest<WooProduct>(
          "POST",
          "/products",
          {},
          payload,
        );

        return successResult({
          message: "Product created successfully.",
          product: formatProduct(product),
        });
      } catch (error: unknown) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "get_product",
    {
      description:
        "Get a WooCommerce product by its numeric product ID. " +
        "Returns a limited set of product fields.",
      inputSchema: {
        id: z.number().int().min(1).max(2147483647),
      },
    },
    async ({ id }) => {
      try {
        const product = await wooGet<WooProduct>(
          `/products/${id}`,
          {},
        );

        return successResult({
          product: formatProduct(product),
        });
      } catch (error: unknown) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "list_product_categories",
    {
      description:
        "List WooCommerce product categories with pagination.",
      inputSchema: {
        page: z.number().int().min(1).max(100).default(1),
        perPage: z.number().int().min(1).max(25).default(10),
      },
    },
    async ({ page, perPage }) => {
      try {
        const categories = await wooGet<WooCategory[]>(
          "/products/categories",
          {
            page: String(page),
            per_page: String(perPage),
          },
        );

        return successResult({
          categories: categories.map((category) => ({
            id: category.id,
            name: category.name,
            slug: category.slug,
            parent: category.parent,
            count: category.count,
          })),
          page,
          perPage,
        });
      } catch (error: unknown) {
        return errorResult(error);
      }
    },
  );

  return server;
}

app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "urumi-woocommerce-mcp",
    wooCommerceConfigured: isWooConfigured(),
  });
});

// Stateless Streamable HTTP MCP endpoint.
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
      "WooCommerce MCP request failed:",
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
  process.env.WOOCOMMERCE_MCP_PORT ?? "9100",
  10,
);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("WOOCOMMERCE_MCP_PORT must be a valid TCP port.");
}

// Start listening only when this file is executed directly.
// Importing the app in tests must not bind the production port.
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  app.listen(port, "0.0.0.0", () => {
    console.log(`WooCommerce MCP Server listening on port ${port}`);
  });
}