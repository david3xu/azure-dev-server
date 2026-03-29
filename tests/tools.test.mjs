// Do the phase-2 tools (edit_file, search_files) behave correctly?

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const PORT = 13580;
const API_KEY = "test-tools-key-12345";
const BASE_URL = `http://localhost:${PORT}`;

let serverProcess;
let workspaceDir;
let client;
let transport;

before(async () => {
  workspaceDir = await mkdtemp(path.join(os.tmpdir(), "azure-dev-tools-"));

  serverProcess = spawn("node", ["dist/server.js"], {
    env: {
      ...process.env,
      PORT: String(PORT),
      MCP_API_KEY: API_KEY,
      WORKSPACE: workspaceDir,
    },
    stdio: "pipe",
  });

  await new Promise((resolve, reject) => {
    serverProcess.stdout.on("data", (data) => {
      if (data.toString().includes("azure-dev-commander running")) {
        resolve();
      }
    });
    serverProcess.on("error", reject);
    sleep(3000).then(resolve);
  });

  client = new Client({ name: "tools-test-client", version: "0.1.0" });
  transport = new StreamableHTTPClientTransport(new URL(`${BASE_URL}/mcp?key=${API_KEY}`));
  await client.connect(transport);
});

after(async () => {
  if (transport) {
    await transport.close();
  }
  if (serverProcess) {
    serverProcess.kill("SIGTERM");
  }
  if (workspaceDir) {
    await rm(workspaceDir, { recursive: true, force: true });
  }
});

describe("phase-2 tools", () => {
  it("exposes edit_file and search_files", async () => {
    const list = await client.listTools();
    const toolNames = list.tools.map((tool) => tool.name);
    assert.ok(toolNames.includes("edit_file"));
    assert.ok(toolNames.includes("search_files"));
  });

  it("edit_file updates content when old_string appears once", async () => {
    const filePath = path.join(workspaceDir, "single-edit.txt");
    await writeFile(filePath, "line one\nalpha target\nline three\n", "utf-8");

    const result = await client.callTool({
      name: "edit_file",
      arguments: {
        path: filePath,
        old_string: "alpha target",
        new_string: "alpha replaced",
      },
    });

    assert.equal(Boolean(result.isError), false);
    const text = firstText(result);
    assert.match(text, /Edited .*single-edit\.txt at line 2/);

    const updated = await readFile(filePath, "utf-8");
    assert.ok(updated.includes("alpha replaced"));
    assert.ok(!updated.includes("alpha target"));
  });

  it("edit_file fails when old_string appears multiple times", async () => {
    const filePath = path.join(workspaceDir, "multi-edit.txt");
    await writeFile(filePath, "dup\nmiddle\ndup\n", "utf-8");

    const result = await client.callTool({
      name: "edit_file",
      arguments: {
        path: filePath,
        old_string: "dup",
        new_string: "once",
      },
    });

    assert.equal(Boolean(result.isError), true);
    assert.match(firstText(result), /appears 2 times/i);

    const unchanged = await readFile(filePath, "utf-8");
    assert.equal(unchanged, "dup\nmiddle\ndup\n");
  });

  it("search_files respects file_pattern and returns matching lines", async () => {
    await mkdir(path.join(workspaceDir, "src"), { recursive: true });
    await writeFile(path.join(workspaceDir, "src", "a.ts"), "const value = 'Needle';\n", "utf-8");
    await writeFile(path.join(workspaceDir, "notes.md"), "needle in markdown\n", "utf-8");

    const result = await client.callTool({
      name: "search_files",
      arguments: {
        path: workspaceDir,
        pattern: "needle",
        file_pattern: "*.ts",
      },
    });

    assert.equal(Boolean(result.isError), false);
    const text = firstText(result);
    assert.match(text, /a\.ts:1:/i);
    assert.doesNotMatch(text, /notes\.md/i);
  });
});

function firstText(result) {
  const first = result.content?.[0];
  return first?.type === "text" ? first.text : "";
}
