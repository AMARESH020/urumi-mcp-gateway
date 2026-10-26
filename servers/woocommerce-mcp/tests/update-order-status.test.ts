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

describe("WooCommerce update_order_status tool", () => {
  it("updates the requested order status using PUT", async () => {
    vi.stubEnv("WOOCOMMERCE_URL", "https://store.example.test");
    vi.stubEnv("WOOCOMMERCE_CONSUMER_KEY", "ck_test");
    vi.stubEnv("WOOCOMMERCE_CONSUMER_SECRET", "cs_test");

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 789,
          status: "completed",
          date_modified: "2026-10-19T12:00:00",
          total: "149.99",
          currency: "USD",
          billing: {
            email: "private-customer@example.test",
          },
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
        id: 1,
        method: "tools/call",
        params: {
          name: "update_order_status",
          arguments: {
            id: 789,
            status: "completed",
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

    expect(result.message).toBe("Order status updated successfully.");
    expect(result.order.id).toBe(789);
    expect(result.order.status).toBe("completed");
    expect(result.order.total).toBe("149.99");
    expect(response.text).not.toContain("private-customer@example.test");

    expect(fetchMock).toHaveBeenCalledOnce();

    const [url, options] = fetchMock.mock.calls[0] as [
      URL | string,
      RequestInit,
    ];

    expect(new URL(String(url)).pathname).toBe(
      "/wp-json/wc/v3/orders/789",
    );
    expect(options.method).toBe("PUT");
    expect(JSON.parse(String(options.body))).toEqual({
      status: "completed",
    });
  });
});