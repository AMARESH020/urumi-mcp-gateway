import dotenv from "dotenv";
import { resolve } from "node:path";

// Load the .env file from the repository root.
dotenv.config({
  path: resolve(process.cwd(), "../../.env")
});

const { app } = await import("./app.js");

const port = Number(process.env.GATEWAY_PORT ?? 4000);

app.listen(port, "0.0.0.0", () => {
  console.log(`Urumi MCP Gateway listening on port ${port}`);
});
