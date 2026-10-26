import {
  describe,
  expect,
  it,
} from "vitest";
import request from "supertest";
import { app } from "../src/index.js";

describe("WooCommerce MCP tool discovery", () => {
  it("advertises all eight WooCommerce tools", async () => {
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

    const dataLine = response.text
      .split(/\r?\n/)
      .find((line) => line.startsWith("data: "));

    expect(dataLine).toBeDefined();

    const message = JSON.parse(dataLine!.slice("data: ".length));

    expect(message.result.tools).toBeDefined();

    const toolNames = message.result.tools.map(
      (tool: { name: string }) => tool.name,
    );

    expect(toolNames).toEqual(
      expect.arrayContaining([
        "search_products",
        "get_product",
        "list_product_categories",
        "list_products",
        "create_product",
        "list_orders",
        "get_order",
        "update_order_status",
      ]),
    );

    expect(toolNames).toHaveLength(8);
  });
});