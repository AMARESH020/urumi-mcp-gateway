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

describe("WooCommerce create_product tool", () => {
  it("creates a product as a draft by default", async () => {
    vi.stubEnv("WOOCOMMERCE_URL", "https://store.example.test");
    vi.stubEnv("WOOCOMMERCE_CONSUMER_KEY", "ck_test");
    vi.stubEnv("WOOCOMMERCE_CONSUMER_SECRET", "cs_test");

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 456,
          name: "Draft Test Product",
          slug: "draft-test-product",
          type: "simple",
          price: "19.99",
          regular_price: "19.99",
          sale_price: "",
          stock_status: "instock",
          permalink: "https://store.example.test/product/draft-test-product",
          on_sale: false,
          categories: [
            { id: 9, name: "Electronics", slug: "electronics" },
          ],
        }),
        {
          status: 201,
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
          name: "create_product",
          arguments: {
            name: "Draft Test Product",
            regularPrice: "19.99",
            stockQuantity: 4,
            categoryIds: [9],
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

    expect(result.message).toBe("Product created successfully.");
    expect(result.product.id).toBe(456);
    expect(result.product.name).toBe("Draft Test Product");

    expect(fetchMock).toHaveBeenCalledOnce();

    const [url, options] = fetchMock.mock.calls[0] as [
      URL | string,
      RequestInit,
    ];

    expect(new URL(String(url)).pathname).toBe("/wp-json/wc/v3/products");
    expect(options.method).toBe("POST");
    expect(options.redirect).toBe("error");

    const headers = options.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(String(options.body));

    expect(body.name).toBe("Draft Test Product");
    expect(body.type).toBe("simple");
    expect(body.status).toBe("draft");
    expect(body.regular_price).toBe("19.99");
    expect(body.manage_stock).toBe(true);
    expect(body.stock_quantity).toBe(4);
    expect(body.categories).toEqual([{ id: 9 }]);
  });
});