import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { globTool } from "@/tools/globTool.js";
import { mkdtemp, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { rimraf } from "rimraf";
import type { ToolContext } from "@/tools/types.js";

const testContext: ToolContext = { workdir: "/test/workdir" };

describe("globTool", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "glob-test-"));

    // Create test file structure
    await mkdir(join(tempDir, "src"), { recursive: true });
    await mkdir(join(tempDir, "tests"), { recursive: true });
    await mkdir(join(tempDir, "docs"), { recursive: true });

    await writeFile(
      join(tempDir, "src/index.ts"),
      "export const app = 'main';",
    );
    await writeFile(
      join(tempDir, "src/utils.ts"),
      "export const utils = 'helper';",
    );
    await writeFile(
      join(tempDir, "tests/app.test.js"),
      "test('app', () => {});",
    );
    await writeFile(join(tempDir, "docs/README.md"), "# Documentation");
    await writeFile(join(tempDir, "package.json"), "{}");
    await writeFile(join(tempDir, ".gitignore"), "node_modules/");

    // Wait to ensure file timestamps are different
    await new Promise((resolve) => setTimeout(resolve, 10));
  });

  afterEach(async () => {
    await rimraf(tempDir);
  });

  it("should be properly configured", () => {
    expect(globTool.name).toBe("Glob");
    expect(globTool.config.type).toBe("function");
    if (
      globTool.config.type === "function" &&
      globTool.config.function.parameters
    ) {
      expect(globTool.config.function.name).toBe("Glob");
      expect(globTool.config.function.parameters.required).toEqual(["pattern"]);
    }
  });

  it("should find TypeScript files with **/*.ts pattern", async () => {
    const result = await globTool.execute(
      { pattern: "**/*.ts" },
      { workdir: tempDir },
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("src/index.ts");
    expect(result.content).toContain("src/utils.ts");
    expect(result.shortResult).toContain("Found 2 files");
  });

  it("should find all files with ** pattern", async () => {
    const result = await globTool.execute(
      { pattern: "**/*" },
      { workdir: tempDir },
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("package.json");
    expect(result.content).toContain("src/index.ts");
    expect(result.content).toContain("tests/app.test.js");
    expect(result.content).toContain("docs/README.md");
  });

  it("should find files in specific directory", async () => {
    const result = await globTool.execute(
      { pattern: "src/*" },
      { workdir: tempDir },
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("src/index.ts");
    expect(result.content).toContain("src/utils.ts");
    expect(result.content).not.toContain("package.json");
  });

  it("should return no matches for non-existent pattern", async () => {
    const result = await globTool.execute(
      { pattern: "**/*.nonexistent" },
      { workdir: tempDir },
    );

    expect(result.success).toBe(true);
    expect(result.content).toBe("No files match the pattern");
    expect(result.shortResult).toBe("No matches found");
  });

  it("should work with custom search path", async () => {
    const srcDir = join(tempDir, "src");
    const result = await globTool.execute(
      { pattern: "*.ts", path: srcDir },
      testContext,
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("index.ts");
    expect(result.content).toContain("utils.ts");
  });

  it("should return error for missing pattern", async () => {
    const result = await globTool.execute({}, testContext);

    expect(result.success).toBe(false);
    expect(result.error).toContain("pattern parameter is required");
  });

  it("should return error for invalid pattern type", async () => {
    const result = await globTool.execute({ pattern: 123 }, testContext);

    expect(result.success).toBe(false);
    expect(result.error).toContain(
      "pattern parameter is required and must be a string",
    );
  });

  it("should format compact parameters correctly", () => {
    const params1 = { pattern: "**/*.ts" };
    expect(globTool.formatCompactParams?.(params1, testContext)).toBe(
      "**/*.ts",
    );

    const params2 = { pattern: "*.js", path: "/custom/path" };
    expect(globTool.formatCompactParams?.(params2, testContext)).toBe(
      "*.js in /custom/path",
    );
  });

  it("should sort files by modification time", async () => {
    // Create files and ensure different modification times
    const file1 = join(tempDir, "file1.txt");
    const file2 = join(tempDir, "file2.txt");

    await writeFile(file1, "content1");
    await new Promise((resolve) => setTimeout(resolve, 50)); // Wait to ensure time difference
    await writeFile(file2, "content2");

    const result = await globTool.execute(
      { pattern: "file*.txt" },
      { workdir: tempDir },
    );

    expect(result.success).toBe(true);
    const lines = result.content.split("\n");
    // Most recently modified files should come first
    expect(lines[0]).toContain("file2.txt");
    expect(lines[1]).toContain("file1.txt");
  });

  it("should respect gitignore patterns", async () => {
    // Create node_modules directory and files
    await mkdir(join(tempDir, "node_modules"), { recursive: true });
    await writeFile(
      join(tempDir, "node_modules/package.js"),
      "module.exports = {};",
    );

    const result = await globTool.execute(
      { pattern: "**/*.js" },
      { workdir: tempDir },
    );

    expect(result.success).toBe(true);
    // Should include .js files in tests directory
    expect(result.content).toContain("tests/app.test.js");
    // But should not include files under node_modules (ignored by gitignore)
    expect(result.content).not.toContain("node_modules/package.js");
  });
});
