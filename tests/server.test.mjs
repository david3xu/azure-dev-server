// Does the HTTP server start and respond correctly?

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = 13579;
const API_KEY = "test-key-12345";
const BASE_URL = `http://localhost:${PORT}`;

let serverProcess;

before(async () => {
  serverProcess = spawn("node", ["dist/server.js"], {
    env: {
      ...process.env,
      PORT: String(PORT),
      MCP_API_KEY: API_KEY,
      WORKSPACE: process.cwd(),
    },
    stdio: "pipe",
  });

  // Wait for server to start
  await new Promise((resolve, reject) => {
    serverProcess.stdout.on("data", (data) => {
      if (data.toString().includes("azure-dev-commander running")) {
        resolve();
      }
    });
    serverProcess.stderr.on("data", (data) => {
      console.error("Server stderr:", data.toString());
    });
    serverProcess.on("error", reject);
    // Fallback timeout
    sleep(3000).then(resolve);
  });
});

after(() => {
  if (serverProcess) {
    serverProcess.kill("SIGTERM");
  }
});

describe("azure-dev-commander server", () => {
  it("health endpoint returns ok", async () => {
    const res = await fetch(`${BASE_URL}/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, "ok");
    assert.ok(body.workspace);
  });

  it("rejects unauthenticated MCP requests", async () => {
    const res = await fetch(`${BASE_URL}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "1",
        method: "initialize",
        params: {},
      }),
    });
    assert.equal(res.status, 401);
  });

  it("accepts authenticated MCP initialize request", async () => {
    const res = await fetch(`${BASE_URL}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "x-api-key": API_KEY,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "1",
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "test-client", version: "0.1.0" },
        },
      }),
    });
    assert.equal(res.status, 200);
    const sessionId = res.headers.get("mcp-session-id");
    assert.ok(sessionId, "Response should include mcp-session-id header");
    const body = await res.text();
    assert.ok(body.includes("azure-dev-commander"), "Response should contain server name");
  });

  it("rejects GET /mcp without valid session", async () => {
    const res = await fetch(`${BASE_URL}/mcp`, {
      headers: {
        "x-api-key": API_KEY,
        "mcp-session-id": "nonexistent-session",
      },
    });
    assert.equal(res.status, 400);
  });

  it("DELETE /mcp returns 200 for unknown session", async () => {
    const res = await fetch(`${BASE_URL}/mcp`, {
      method: "DELETE",
      headers: { "mcp-session-id": "nonexistent" },
    });
    assert.equal(res.status, 200);
  });
});
