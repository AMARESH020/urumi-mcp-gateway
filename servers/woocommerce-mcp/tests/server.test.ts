
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import request from "supertest";
import { app } from "../src/index.js";

beforeEach(() => {
  // Ensure tests never use real WooCommerce credentials.
  vi.stubEnv("WOOCOMMERCE_URL", "");
  vi.stubEnv("WOOCOMMERCE_CONSUMER_KEY", "");
  vi.stubEnv("WOOCOMMERCE_CONSUMER_SECRET", "");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("WooCommerce MCP Server", () => {
  it("reports healthy when store credentials are missing", async () => {
    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("ok");
    expect(response.body.service).toBe("urumi-woocommerce-mcp");
    expect(response.body.wooCommerceConfigured).toBe(false);
  });

  it("advertises all three WooCommerce tools", async () => {
    const response = await request(app)
      .post("/mcp")
      .set("Accept", "application/json, text/event-stream")
      .send({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {},
      });

    expect(response.status).toBe(200);
    expect(response.text).toContain("search_products");
    expect(response.text).toContain("get_product");
    expect(response.text).toContain("list_products");

    expect(response.text).toContain("list_product_categories");
  });

  it("returns a safe tool error when credentials are missing", async () => {
    const response = await request(app)
      .post("/mcp")
      .set("Accept", "application/json, text/event-stream")
      .send({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "search_products",
          arguments: {
            query: "laptop",
          },
        },
      });

    expect(response.status).toBe(200);

    const dataLine = response.text
      .split(/\r?\n/)
      .find((line) => line.startsWith("data: "));

    expect(dataLine).toBeDefined();

    const message = JSON.parse(dataLine!.slice("data: ".length));

    expect(message.result.isError).toBe(true);
    expect(message.result.content[0].text).toContain(
      "WooCommerce is not configured.",
    );
  });

  it("searches products using mocked WooCommerce credentials", async () => {
    vi.stubEnv(
      "WOOCOMMERCE_URL",
      "https://store.example.test",
    );
    vi.stubEnv(
      "WOOCOMMERCE_CONSUMER_KEY",
      "ck_test_consumer_key",
    );
    vi.stubEnv(
      "WOOCOMMERCE_CONSUMER_SECRET",
      "cs_test_consumer_secret",
    );

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            id: 123,
            name: "Test Laptop",
            slug: "test-laptop",
            type: "simple",
            price: "999.00",
            regular_price: "999.00",
            sale_price: "",
            stock_status: "instock",
            permalink:
              "https://store.example.test/product/test-laptop",
            on_sale: false,
            categories: [
              {
                id: 9,
                name: "Electronics",
                slug: "electronics",
              },
            ],
          },
        ]),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      ),
    );

    vi.stubGlobal("fetch", fetchMock);

    const response = await request(app)
      .post("/mcp")
      .set("Accept", "application/json, text/event-stream")
      .send({
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: {
          name: "search_products",
          arguments: {
            query: "laptop",
          },
        },
      });

    expect(response.status).toBe(200);

    const dataLine = response.text
      .split(/\r?\n/)
      .find((line) => line.startsWith("data: "));

    expect(dataLine).toBeDefined();

    const message = JSON.parse(dataLine!.slice("data: ".length));

    expect(message.result.isError).toBeUndefined();

    const result = JSON.parse(message.result.content[0].text);

    expect(result.products).toHaveLength(1);
    expect(result.products[0].id).toBe(123);
    expect(result.products[0].name).toBe("Test Laptop");
    expect(result.products[0].stockStatus).toBe("instock");

    expect(fetchMock).toHaveBeenCalledOnce();

    const [url, options] = fetchMock.mock.calls[0] as [
      string,
      RequestInit,
    ];

    const requestedUrl = new URL(url);

    expect(requestedUrl.origin).toBe(
      "https://store.example.test",
    );
    expect(requestedUrl.pathname).toBe(
      "/wp-json/wc/v3/products",
    );
    expect(requestedUrl.searchParams.get("search")).toBe("laptop");
    expect(options.method).toBe("GET");

    const headers = options.headers as Record<string, string>;

    expect(headers.Authorization).toBe(
      `Basic ${Buffer.from(
        "ck_test_consumer_key:cs_test_consumer_secret",
      ).toString("base64")}`,
    );
  });
  it("gets a product by ID using a mocked WooCommerce response", async () => {
  vi.stubEnv("WOOCOMMERCE_URL", "https://store.example.test");
  vi.stubEnv("WOOCOMMERCE_CONSUMER_KEY", "ck_test");
  vi.stubEnv("WOOCOMMERCE_CONSUMER_SECRET", "cs_test");

  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        id: 123,
        name: "Test Laptop",
        slug: "test-laptop",
        type: "simple",
        price: "999.00",
        regular_price: "999.00",
        sale_price: "",
        stock_status: "instock",
        permalink: "https://store.example.test/product/test-laptop",
        on_sale: false,
        categories: [],
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    ),
  );

  vi.stubGlobal("fetch", fetchMock);

  const response = await request(app)
    .post("/mcp")
    .set("Accept", "application/json, text/event-stream")
    .send({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "get_product",
        arguments: { id: 123 },
      },
    });

  expect(response.status).toBe(200);

  const dataLine = response.text
    .split(/\r?\n/)
    .find((line) => line.startsWith("data: "));

  expect(dataLine).toBeDefined();

  const message = JSON.parse(dataLine!.slice("data: ".length));
  expect(message.result.isError).toBeUndefined();

  const result = JSON.parse(message.result.content[0].text);

  expect(result.product.id).toBe(123);
  expect(result.product.name).toBe("Test Laptop");
  expect(fetchMock).toHaveBeenCalledOnce();

  const [url] = fetchMock.mock.calls[0] as [string, RequestInit];

  expect(new URL(url).pathname).toBe("/wp-json/wc/v3/products/123");
});

it("lists product categories using a mocked WooCommerce response", async () => {
  vi.stubEnv("WOOCOMMERCE_URL", "https://store.example.test");
  vi.stubEnv("WOOCOMMERCE_CONSUMER_KEY", "ck_test");
  vi.stubEnv("WOOCOMMERCE_CONSUMER_SECRET", "cs_test");

  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify([
        {
          id: 9,
          name: "Electronics",
          slug: "electronics",
          parent: 0,
          count: 12,
        },
      ]),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    ),
  );

  vi.stubGlobal("fetch", fetchMock);

  const response = await request(app)
    .post("/mcp")
    .set("Accept", "application/json, text/event-stream")
    .send({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: {
        name: "list_product_categories",
        arguments: { page: 1, perPage: 10 },
      },
    });

  expect(response.status).toBe(200);

  const dataLine = response.text
    .split(/\r?\n/)
    .find((line) => line.startsWith("data: "));

  expect(dataLine).toBeDefined();

  const message = JSON.parse(dataLine!.slice("data: ".length));
  expect(message.result.isError).toBeUndefined();

  const result = JSON.parse(message.result.content[0].text);

  expect(result.categories).toHaveLength(1);
  expect(result.categories[0].name).toBe("Electronics");
  expect(result.categories[0].count).toBe(12);
  expect(fetchMock).toHaveBeenCalledOnce();

  const [url] = fetchMock.mock.calls[0] as [string, RequestInit];

  expect(new URL(url).pathname).toBe(
    "/wp-json/wc/v3/products/categories",
  );
});

it("rejects invalid product IDs without calling WooCommerce", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);

  const response = await request(app)
    .post("/mcp")
    .set("Accept", "application/json, text/event-stream")
    .send({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: {
        name: "get_product",
        arguments: { id: "not-a-number" },
      },
    });

  expect(response.status).toBe(200);

  const dataLine = response.text
    .split(/\r?\n/)
    .find((line) => line.startsWith("data: "));

  expect(dataLine).toBeDefined();

  const message = JSON.parse(dataLine!.slice("data: ".length));

  expect(
    message.error !== undefined || message.result?.isError === true,
  ).toBe(true);

  expect(fetchMock).not.toHaveBeenCalled();
});

it("handles WooCommerce API failures safely", async () => {
  vi.stubEnv("WOOCOMMERCE_URL", "https://store.example.test");
  vi.stubEnv("WOOCOMMERCE_CONSUMER_KEY", "ck_test");
  vi.stubEnv("WOOCOMMERCE_CONSUMER_SECRET", "cs_test");

  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({ message: "Simulated upstream failure" }),
      {
        status: 503,
        headers: { "content-type": "application/json" },
      },
    ),
  );

  vi.stubGlobal("fetch", fetchMock);

  const response = await request(app)
    .post("/mcp")
    .set("Accept", "application/json, text/event-stream")
    .send({
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: {
        name: "search_products",
        arguments: { query: "laptop" },
      },
    });

  expect(response.status).toBe(200);

  const dataLine = response.text
    .split(/\r?\n/)
    .find((line) => line.startsWith("data: "));

  expect(dataLine).toBeDefined();

  const message = JSON.parse(dataLine!.slice("data: ".length));

  expect(message.result.isError).toBe(true);
  expect(message.result.content[0].text).toContain(
    "WooCommerce API returned HTTP 503",
  );

  // The implementation must not expose the upstream response body.
  expect(response.text).not.toContain("Simulated upstream failure");
});
});
