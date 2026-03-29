// How are filesystem read and search operations implemented?

import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

export const SEARCH_MAX_RESULTS = 100;
export const EDIT_PREVIEW_CONTEXT_LINES = 2;

export async function listRecursive(
  dirPath: string,
  depth: number,
  prefix = "",
): Promise<string[]> {
  const results: string[] = [];
  const entries = await readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".gitignore") continue;
    const fullPath = path.join(dirPath, entry.name);
    const display = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      results.push(`[DIR] ${display}`);
      if (depth > 1 && entry.name !== "node_modules") {
        const children = await listRecursive(fullPath, depth - 1, display);
        results.push(...children);
      }
    } else {
      results.push(`[FILE] ${display}`);
    }
  }
  return results;
}

export function findSingleOccurrence(
  content: string,
  target: string,
): { firstIndex: number; count: number } {
  let count = 0;
  let firstIndex = -1;
  let index = content.indexOf(target);

  while (index !== -1) {
    count += 1;
    if (firstIndex === -1) {
      firstIndex = index;
    }
    index = content.indexOf(target, index + target.length);
  }

  return { firstIndex, count };
}

export function buildEditPreview(content: string, editedLine: number, replacement: string): string {
  const lines = content.split("\n");
  const replacementLines = Math.max(1, replacement.split("\n").length);
  const startLine = Math.max(1, editedLine - EDIT_PREVIEW_CONTEXT_LINES);
  const endLine = Math.min(
    lines.length,
    editedLine + replacementLines + EDIT_PREVIEW_CONTEXT_LINES - 1,
  );

  return lines
    .slice(startLine - 1, endLine)
    .map((line, i) => `${String(startLine + i).padStart(5)} | ${line}`)
    .join("\n");
}

export async function searchFiles(
  searchPath: string,
  pattern: string,
  filePattern?: string,
): Promise<string[]> {
  const targetStat = await stat(searchPath);
  const matcher = createGlobMatcher(filePattern);
  const files = targetStat.isDirectory() ? await collectFiles(searchPath) : [searchPath];
  const needle = pattern.toLowerCase();
  const results: string[] = [];

  for (const filePath of files) {
    const relative = targetStat.isDirectory()
      ? path.relative(searchPath, filePath)
      : path.basename(filePath);
    if (!matcher(relative)) continue;

    const content = await readFile(filePath, "utf-8").catch(() => null);
    if (content === null || content.includes("\u0000")) continue;

    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (line === undefined || !line.toLowerCase().includes(needle)) continue;
      results.push(`${filePath}:${i + 1}: ${line}`);
      if (results.length >= SEARCH_MAX_RESULTS) {
        return results;
      }
    }
  }

  return results;
}

export async function collectFiles(rootDir: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await readdir(rootDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    if (entry.name.startsWith(".")) continue;

    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      const childFiles = await collectFiles(fullPath);
      results.push(...childFiles);
    } else if (entry.isFile()) {
      results.push(fullPath);
    }
  }

  return results;
}

export function createGlobMatcher(globPattern?: string): (candidate: string) => boolean {
  if (!globPattern || globPattern.trim() === "") return () => true;

  const normalizedPattern = globPattern.replaceAll("\\", "/");
  const regex = globToRegExp(normalizedPattern);
  return (candidate: string) => regex.test(candidate.replaceAll(path.sep, "/"));
}

function globToRegExp(globPattern: string): RegExp {
  let regex = "^";
  for (const char of globPattern) {
    if (char === "*") {
      regex += ".*";
    } else if (char === "?") {
      regex += ".";
    } else {
      regex += escapeRegExpChar(char);
    }
  }
  regex += "$";
  return new RegExp(regex, "i");
}

function escapeRegExpChar(char: string): string {
  return /[|\\{}()[\]^$+*?.]/.test(char) ? `\\${char}` : char;
}
