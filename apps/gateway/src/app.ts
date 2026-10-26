import {
  handleCancelChatAction,
  handleChatRequest,
  handleConfirmChatAction,
} from "./chat.js";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { pool } from "./db.js";
import { protectedRouter } from "./routes.js";
import { authenticateApiKey } from "./auth.js";
import { handleUnifiedMcpRequest } from "./unified-mcp.js";

export const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "urumi-mcp-gateway",
    timestamp: new Date().toISOString()
  });
});

app.get("/health/ready", async (_req, res) => {
  try {
    await pool.query("SELECT 1");

    res.status(200).json({
      status: "ready",
      service: "urumi-mcp-gateway",
      database: "connected"
    });
  } catch {
    res.status(503).json({
      status: "not_ready",
      service: "urumi-mcp-gateway",
      database: "unavailable"
    });
  }
});

app.use("/api", protectedRouter);

// OpenAI-powered assistant; requires an authenticated gateway API key.
app.post("/api/chat", authenticateApiKey, handleChatRequest);

// Confirmation endpoints for proposed WooCommerce write actions.
app.post(
  "/api/chat/actions/:id/confirm",
  authenticateApiKey,
  handleConfirmChatAction,
);

app.post(
  "/api/chat/actions/:id/cancel",
  authenticateApiKey,
  handleCancelChatAction,
);
// Unified, API-key-protected MCP endpoint.
app.post("/mcp", authenticateApiKey, handleUnifiedMcpRequest);

// The gateway currently uses stateless MCP transport.
app.get("/mcp", authenticateApiKey, (_req, res) => {
  res.status(405).json({
    error: "GET is not supported by this stateless MCP endpoint",
  });
});

app.delete("/mcp", authenticateApiKey, (_req, res) => {
  res.status(405).json({
    error: "Session deletion is not supported by this stateless MCP endpoint",
  });
});
