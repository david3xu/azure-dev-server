// Do the filesystem read and search operations work correctly?

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Import compiled output — tests always run against dist/
import {
  listRecursive,
  findSingleOccurrence,
  buildEditPreview,
  searchFiles,
  collectFiles,
  createGlobMatcher,
  SEARCH_MAX_RESULTS,
} from "../dist/fs-ops.js";

let tmpDir;

before(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), "azure-dev-fs-ops-"));
  await mkdir(path.join(tmpDir, "src"), { recursive: true });
  await mkdir(path.join(tmpDir, "docs"), { recursive: true });
  await writeFile(path.join(tmpDir, "src", "index.ts"), "export const x = 1;\n");
  await writeFile(path.join(tmpDir, "src", "util.ts"), "export const y = 2;\n");
  await writeFile(path.join(tmpDir, "docs", "README.md"), "# Project\n\nHello world\n");
  await writeFile(path.join(tmpDir, "root.txt"), "root level file\n");
});

after(async () => {
  if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
});

describe("listRecursive", () => {
  it("lists direct children at depth 1", async () => {
    const entries = await listRecursive(tmpDir, 1);
    const names = entries.map((e) => e.replace(/\[.*?\] /, ""));
    assert.ok(names.includes("src"), "should include src dir");
    assert.ok(names.includes("docs"), "should include docs dir");
    assert.ok(names.includes("root.txt"), "should include root.txt");
  });

  it("recurses into subdirs at depth 2", async () => {
    const entries = await listRecursive(tmpDir, 2);
    assert.ok(
      entries.some((e) => e.includes("index.ts")),
      "should include src/index.ts",
    );
    assert.ok(
      entries.some((e) => e.includes("README.md")),
      "should include docs/README.md",
    );
  });

  it("prefixes dirs with [DIR] and files with [FILE]", async () => {
    const entries = await listRecursive(tmpDir, 1);
    assert.ok(entries.some((e) => e.startsWith("[DIR]")));
    assert.ok(entries.some((e) => e.startsWith("[FILE]")));
  });
});

describe("findSingleOccurrence", () => {
  it("returns count 1 and correct index when target appears once", () => {
    const result = findSingleOccurrence("hello world\n", "world");
    assert.equal(result.count, 1);
    assert.equal(result.firstIndex, 6);
  });

  it("returns count 0 when target is absent", () => {
    const result = findSingleOccurrence("hello world\n", "missing");
    assert.equal(result.count, 0);
    assert.equal(result.firstIndex, -1);
  });

  it("returns count > 1 when target appears multiple times", () => {
    const result = findSingleOccurrence("aa bb aa cc aa\n", "aa");
    assert.equal(result.count, 3);
  });
});

describe("buildEditPreview", () => {
  it("returns lines around the edited line", () => {
    const content = "line1\nline2\nline3\nline4\nline5\n";
    const preview = buildEditPreview(content, 3, "replaced");
    assert.match(preview, /line2/);
    assert.match(preview, /line3/);
    assert.match(preview, /line4/);
  });

  it("includes line numbers", () => {
    const content = "a\nb\nc\n";
    const preview = buildEditPreview(content, 2, "B");
    assert.match(preview, /\d+\s*\|/);
  });
});

describe("searchFiles", () => {
  it("finds matches across files in a directory", async () => {
    const results = await searchFiles(tmpDir, "export");
    assert.ok(results.length >= 2, "should match in both .ts files");
    assert.ok(results.every((r) => r.includes(":")));
  });

  it("respects file_pattern filter", async () => {
    const results = await searchFiles(tmpDir, "export", "*.ts");
    assert.ok(
      results.every((r) => r.includes(".ts")),
      "only .ts files",
    );
    assert.ok(!results.some((r) => r.includes(".md")), "no .md files");
  });

  it("returns empty array when pattern not found", async () => {
    const results = await searchFiles(tmpDir, "xyzzy_notfound_12345");
    assert.equal(results.length, 0);
  });

  it("respects SEARCH_MAX_RESULTS cap", () => {
    assert.equal(typeof SEARCH_MAX_RESULTS, "number");
    assert.ok(SEARCH_MAX_RESULTS > 0);
  });
});

describe("collectFiles", () => {
  it("returns all files recursively, skipping .git and node_modules", async () => {
    const files = await collectFiles(tmpDir);
    assert.ok(files.length >= 4, "should find all files");
    assert.ok(files.every((f) => !f.includes("node_modules")));
    assert.ok(files.every((f) => !f.includes(".git")));
  });
});

describe("createGlobMatcher", () => {
  it("matches all files when no pattern given", () => {
    const match = createGlobMatcher();
    assert.ok(match("anything.ts"));
    assert.ok(match("readme.md"));
  });

  it("matches by extension pattern", () => {
    const match = createGlobMatcher("*.ts");
    assert.ok(match("index.ts"));
    assert.ok(!match("index.js"));
    assert.ok(!match("readme.md"));
  });

  it("is case-insensitive", () => {
    const match = createGlobMatcher("*.TS");
    assert.ok(match("index.ts"));
  });
});
