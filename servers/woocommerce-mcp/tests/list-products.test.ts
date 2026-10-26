import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import request from "supertest";
import { app } from "../src/index.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("WooCommerce list_products tool", () => {
  it("lists products with pagination and category/status filters", async () => {
    vi.stubEnv("WOOCOMMERCE_URL", "https://store.example.test");
    vi.stubEnv("WOOCOMMERCE_CONSUMER_KEY", "ck_test");
    vi.stubEnv("WOOCOMMERCE_CONSUMER_SECRET", "cs_test");

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
            permalink: "https://store.example.test/product/test-laptop",
            on_sale: false,
            categories: [
              { id: 9, name: "Electronics", slug: "electronics" },
            ],
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
        id: 1,
        method: "tools/call",
        params: {
          name: "list_products",
          arguments: {
            page: 2,
            perPage: 5,
            categoryId: 9,
            status: "publish",
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
    expect(result.page).toBe(2);
    expect(result.perPage).toBe(5);

    expect(fetchMock).toHaveBeenCalledOnce();

    const [url, options] = fetchMock.mock.calls[0] as [
      URL | string,
      RequestInit,
    ];

    const requestedUrl = new URL(String(url));

    expect(requestedUrl.pathname).toBe("/wp-json/wc/v3/products");
    expect(requestedUrl.searchParams.get("page")).toBe("2");
    expect(requestedUrl.searchParams.get("per_page")).toBe("5");
    expect(requestedUrl.searchParams.get("category")).toBe("9");
    expect(requestedUrl.searchParams.get("status")).toBe("publish");
    expect(options.method).toBe("GET");
  });
});