// How does the HTTP server start and route requests?

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type Request, type Response } from "express";
import { checkApiKey } from "./auth.js";
import { registerTools } from "./tools.js";
import type { ServerConfig } from "./types.js";

const config: ServerConfig = {
  port: parseInt(process.env["PORT"] ?? "3001", 10),
  apiKey: process.env["MCP_API_KEY"] ?? "dev-key-change-me",
  workspace: process.env["WORKSPACE"] ?? process.cwd(),
};

const sessions = new Map<string, StreamableHTTPServerTransport>();

function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: "azure-dev-commander", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );
  registerTools(server, config.workspace);
  return server;
}

async function handleNewSession(req: Request, res: Response): Promise<void> {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
  });

  const server = createMcpServer();

  transport.onclose = () => {
    const sid = transport.sessionId;
    if (sid) sessions.delete(sid);
  };

  await server.connect(transport);
  await transport.handleRequest(req, res);

  // The session ID is assigned during the initialize request handling.
  // Persist it after the first request so follow-up calls route correctly.
  const sid = transport.sessionId;
  if (sid && !sessions.has(sid)) {
    sessions.set(sid, transport);
    console.log(`New session: ${sid}`);
  }
}

const app = express();

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", workspace: config.workspace, sessions: sessions.size });
});

app.post("/mcp", async (req: Request, res: Response) => {
  if (!checkApiKey(req, res, config.apiKey)) return;

  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  if (sessionId) {
    const transport = sessions.get(sessionId);
    if (transport) {
      await transport.handleRequest(req, res);
      return;
    }
  }

  try {
    await handleNewSession(req, res);
  } catch (err: unknown) {
    console.error("Failed to create session:", err);
    res.status(500).json({ error: "Session creation failed" });
  }
});

app.get("/mcp", async (req: Request, res: Response) => {
  if (!checkApiKey(req, res, config.apiKey)) return;

  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  const transport = sessionId ? sessions.get(sessionId) : undefined;
  if (!transport) {
    res.status(400).json({ error: "Invalid or missing session" });
    return;
  }
  await transport.handleRequest(req, res);
});

app.delete("/mcp", async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  const transport = sessionId ? sessions.get(sessionId) : undefined;
  if (transport) {
    await transport.handleRequest(req, res);
    if (sessionId) sessions.delete(sessionId);
  } else {
    res.status(200).end();
  }
});

const httpServer = app.listen(config.port, () => {
  console.log(`azure-dev-commander running on http://localhost:${config.port}/mcp`);
  console.log(`Workspace: ${config.workspace}`);
  console.log(`Auth: x-api-key header required`);
});

function shutdown(signal: string): void {
  console.log(`${signal} received — closing server gracefully`);
  httpServer.close(() => {
    console.log("HTTP server closed");
    process.exit(0);
  });
  // Force exit if server hasn't closed within 10s
  setTimeout(() => {
    console.error("Forced shutdown after timeout");
    process.exit(1);
  }, 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
