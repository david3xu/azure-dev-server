// What tools can Claude Desktop use remotely?

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFile, stat, writeFile, mkdir } from "node:fs/promises";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import type { FileInfo } from "./types.js";
import {
  SEARCH_MAX_RESULTS,
  listRecursive,
  findSingleOccurrence,
  buildEditPreview,
  searchFiles,
} from "./fs-ops.js";

const execAsync = promisify(exec);

export function registerTools(server: McpServer, workspace: string): void {
  server.tool("ping", "Health check — verify the remote server is reachable", {}, async () => ({
    content: [{ type: "text" as const, text: `alive — workspace: ${workspace}` }],
  }));

  server.tool(
    "read_file",
    "Read contents of a file. Returns text with line numbers.",
    { path: z.string().describe("Absolute path to the file") },
    async ({ path: filePath }) => {
      try {
        const content = await readFile(filePath, "utf-8");
        const numbered = content
          .split("\n")
          .map((line, i) => `${String(i + 1).padStart(5)} | ${line}`)
          .join("\n");
        return { content: [{ type: "text" as const, text: numbered }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true };
      }
    },
  );

  server.tool(
    "write_file",
    "Write content to a file. Creates parent directories if needed.",
    {
      path: z.string().describe("Absolute path to write"),
      content: z.string().describe("File content"),
      mode: z.enum(["rewrite", "append"]).default("rewrite").describe("Write mode"),
    },
    async ({ path: filePath, content, mode }) => {
      try {
        await mkdir(path.dirname(filePath), { recursive: true });
        if (mode === "append") {
          const existing = await readFile(filePath, "utf-8").catch(() => "");
          await writeFile(filePath, existing + content, "utf-8");
        } else {
          await writeFile(filePath, content, "utf-8");
        }
        const info = await stat(filePath);
        return {
          content: [{ type: "text" as const, text: `Written ${info.size} bytes to ${filePath}` }],
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true };
      }
    },
  );

  server.tool(
    "edit_file",
    "Replace exact text in a file. old_string must appear exactly once.",
    {
      path: z.string().describe("Absolute path to edit"),
      old_string: z.string().min(1).describe("Exact text to replace"),
      new_string: z.string().describe("Replacement text"),
    },
    async ({ path: filePath, old_string: oldString, new_string: newString }) => {
      try {
        const current = await readFile(filePath, "utf-8");
        const match = findSingleOccurrence(current, oldString);
        if (match.count === 0) {
          return {
            content: [{ type: "text" as const, text: "Error: old_string not found in file" }],
            isError: true,
          };
        }
        if (match.count > 1) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: old_string appears ${match.count} times; expected exactly 1`,
              },
            ],
            isError: true,
          };
        }

        const updated =
          current.slice(0, match.firstIndex) +
          newString +
          current.slice(match.firstIndex + oldString.length);
        await writeFile(filePath, updated, "utf-8");

        const editedLine = current.slice(0, match.firstIndex).split("\n").length;
        const preview = buildEditPreview(updated, editedLine, newString);
        return {
          content: [
            {
              type: "text" as const,
              text: `Edited ${filePath} at line ${editedLine}\n${preview}`,
            },
          ],
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true };
      }
    },
  );

  server.tool(
    "search_files",
    "Search for text in files under a path. Returns file:line: content.",
    {
      path: z.string().describe("Absolute file or directory path"),
      pattern: z.string().min(1).describe("Text pattern to search"),
      file_pattern: z.string().optional().describe("Optional wildcard filter, e.g. *.ts"),
    },
    async ({ path: searchPath, pattern, file_pattern: filePattern }) => {
      try {
        const matches = await searchFiles(searchPath, pattern, filePattern);
        if (matches.length === 0) {
          return { content: [{ type: "text" as const, text: "(no matches)" }] };
        }

        const truncated = matches.length === SEARCH_MAX_RESULTS;
        const output = truncated
          ? `${matches.join("\n")}\n... truncated at ${SEARCH_MAX_RESULTS} matches`
          : matches.join("\n");
        return { content: [{ type: "text" as const, text: output }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true };
      }
    },
  );

  server.tool(
    "list_directory",
    "List files and directories. Returns [FILE] or [DIR] prefixed entries.",
    {
      path: z.string().describe("Absolute directory path"),
      depth: z.number().default(1).describe("Recursion depth (1 = direct children)"),
    },
    async ({ path: dirPath, depth }) => {
      try {
        const entries = await listRecursive(dirPath, depth);
        return { content: [{ type: "text" as const, text: entries.join("\n") }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true };
      }
    },
  );

  server.tool(
    "run_command",
    "Execute a shell command and return stdout/stderr.",
    {
      command: z.string().describe("Shell command to execute"),
      cwd: z.string().optional().describe("Working directory (default: WORKSPACE)"),
    },
    async ({ command, cwd }) => {
      try {
        const { stdout, stderr } = await execAsync(command, {
          cwd: cwd ?? workspace,
          timeout: 60_000,
          maxBuffer: 10 * 1024 * 1024,
        });
        let output = "";
        if (stdout) output += stdout;
        if (stderr) output += `\n--- stderr ---\n${stderr}`;
        return { content: [{ type: "text" as const, text: output || "(no output)" }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `Command failed: ${msg}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "get_file_info",
    "Get file metadata: size, modified time, type.",
    { path: z.string().describe("Absolute path to file or directory") },
    async ({ path: filePath }) => {
      try {
        const s = await stat(filePath);
        const info: FileInfo = {
          size: s.size,
          isFile: s.isFile(),
          isDirectory: s.isDirectory(),
          modified: s.mtime.toISOString(),
          created: s.birthtime.toISOString(),
          permissions: (s.mode & 0o777).toString(8),
        };
        return { content: [{ type: "text" as const, text: JSON.stringify(info, null, 2) }] };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true };
      }
    },
  );
}
