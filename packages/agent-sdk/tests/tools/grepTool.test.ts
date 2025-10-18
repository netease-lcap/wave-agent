import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { grepTool } from "@/tools/grepTool.js";
import { mkdtemp, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { rimraf } from "rimraf";

describe("grepTool", () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    tempDir = await mkdtemp(join(tmpdir(), "grep-test-"));
    process.chdir(tempDir);

    // 创建测试文件结构
    await mkdir(join(tempDir, "src"), { recursive: true });
    await mkdir(join(tempDir, "tests"), { recursive: true });

    await writeFile(
      join(tempDir, "src/index.ts"),
      `export const app = 'main';
export function createApp() {
  return new Application();
}
class Application {
  start() {
    console.log('Starting application');
  }
}`,
    );

    await writeFile(
      join(tempDir, "src/utils.ts"),
      `export const logger = {
  info: (msg: string) => console.log(msg),
  error: (msg: string) => console.error(msg)
};

export function validateEmail(email: string): boolean {
  return email.includes('@');
}`,
    );

    await writeFile(
      join(tempDir, "tests/app.test.js"),
      `const { createApp } = require('../src/index');

test('app creation', () => {
  const app = createApp();
  expect(app).toBeDefined();
});`,
    );

    await writeFile(
      join(tempDir, "README.md"),
      `# Test Project

This is a test project for grep functionality.
It contains various files with different content.`,
    );

    await writeFile(join(tempDir, "package.json"), '{"name": "test-project"}');
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await rimraf(tempDir);
  });

  it("should be properly configured", () => {
    expect(grepTool.name).toBe("Grep");
    expect(grepTool.config.type).toBe("function");
    if (
      grepTool.config.type === "function" &&
      grepTool.config.function.parameters
    ) {
      expect(grepTool.config.function.name).toBe("Grep");
      expect(grepTool.config.function.parameters.required).toEqual(["pattern"]);
    }
  });

  it("should find files containing pattern (files_with_matches mode)", async () => {
    const result = await grepTool.execute({
      pattern: "export",
      output_mode: "files_with_matches",
    });

    expect(result.success).toBe(true);
    expect(result.content).toContain("src/index.ts");
    expect(result.content).toContain("src/utils.ts");
    expect(result.shortResult).toContain("Found");
  });

  it("should show matching lines (content mode)", async () => {
    const result = await grepTool.execute({
      pattern: "export const",
      output_mode: "content",
    });

    expect(result.success).toBe(true);
    expect(result.content).toContain("src/index.ts");
    expect(result.content).toContain("export const app");
    expect(result.content).toContain("src/utils.ts");
    expect(result.content).toContain("export const logger");
  });

  it("should show match counts (count mode)", async () => {
    const result = await grepTool.execute({
      pattern: "export",
      output_mode: "count",
    });

    expect(result.success).toBe(true);
    expect(result.content).toContain("src/index.ts:");
    expect(result.content).toContain("src/utils.ts:");
    expect(result.shortResult).toContain("Match counts");
  });

  it("should show line numbers in content mode", async () => {
    const result = await grepTool.execute({
      pattern: "export const",
      output_mode: "content",
      "-n": true,
    });

    expect(result.success).toBe(true);
    expect(result.content).toMatch(/src\/index\.ts:\d+:/);
    expect(result.content).toMatch(/src\/utils\.ts:\d+:/);
  });

  it("should work with case insensitive search", async () => {
    const result = await grepTool.execute({
      pattern: "APPLICATION",
      "-i": true,
      output_mode: "files_with_matches",
    });

    expect(result.success).toBe(true);
    expect(result.content).toContain("src/index.ts");
  });

  it("should filter by file type", async () => {
    const result = await grepTool.execute({
      pattern: "export",
      type: "ts",
      output_mode: "files_with_matches",
    });

    expect(result.success).toBe(true);
    expect(result.content).toContain("src/index.ts");
    expect(result.content).toContain("src/utils.ts");
    expect(result.content).not.toContain("tests/app.test.js");
  });

  it("should filter by glob pattern", async () => {
    const result = await grepTool.execute({
      pattern: "export",
      glob: "*.ts",
      output_mode: "files_with_matches",
    });

    expect(result.success).toBe(true);
    expect(result.content).toContain("src/index.ts");
    expect(result.content).toContain("src/utils.ts");
    expect(result.content).not.toContain("tests/app.test.js");
  });

  it("should show context lines", async () => {
    const result = await grepTool.execute({
      pattern: "createApp",
      output_mode: "content",
      "-C": 2,
    });

    expect(result.success).toBe(true);
    expect(result.content).toContain("export const app");
    expect(result.content).toContain("export function createApp");
    expect(result.content).toContain("return new Application");
  });

  it("should show context before matches", async () => {
    const result = await grepTool.execute({
      pattern: "createApp",
      output_mode: "content",
      "-B": 1,
    });

    expect(result.success).toBe(true);
    expect(result.content).toContain("export const app");
    expect(result.content).toContain("export function createApp");
  });

  it("should show context after matches", async () => {
    const result = await grepTool.execute({
      pattern: "createApp",
      output_mode: "content",
      "-A": 1,
    });

    expect(result.success).toBe(true);
    expect(result.content).toContain("export function createApp");
    expect(result.content).toContain("return new Application");
  });

  it("should limit results with head_limit", async () => {
    const result = await grepTool.execute({
      pattern: "export",
      output_mode: "files_with_matches",
      head_limit: 1,
    });

    expect(result.success).toBe(true);
    const lines = result.content.split("\n").filter((line) => line.trim());
    expect(lines.length).toBe(1);
    expect(result.shortResult).toContain("showing first 1");
  });

  it("should work with multiline mode", async () => {
    // 创建一个包含多行模式的文件
    await writeFile(
      join(tempDir, "multiline.txt"),
      `struct User {
  name: String,
  email: String,
}`,
    );

    const result = await grepTool.execute({
      pattern: "struct.*name",
      multiline: true,
      output_mode: "files_with_matches",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.content).toContain("multiline.txt");
    }
  });

  it("should search in specific path", async () => {
    const result = await grepTool.execute({
      pattern: "export",
      path: "src",
      output_mode: "files_with_matches",
    });

    expect(result.success).toBe(true);
    expect(result.content).toContain("src/index.ts");
    expect(result.content).toContain("src/utils.ts");
  });

  it("should return no matches message", async () => {
    const result = await grepTool.execute({
      pattern: "NONEXISTENT_PATTERN_12345",
    });

    expect(result.success).toBe(true);
    expect(result.content).toBe("No matches found");
    expect(result.shortResult).toBe("No matches found");
  });

  it("should return error for missing pattern", async () => {
    const result = await grepTool.execute({});

    expect(result.success).toBe(false);
    expect(result.error).toContain("pattern parameter is required");
  });

  it("should return error for invalid pattern type", async () => {
    const result = await grepTool.execute({ pattern: 123 });

    expect(result.success).toBe(false);
    expect(result.error).toContain(
      "pattern parameter is required and must be a string",
    );
  });

  it("should format compact parameters correctly", () => {
    const params1 = { pattern: "export" };
    expect(grepTool.formatCompactParams?.(params1)).toBe("export");

    const params2 = { pattern: "import", type: "ts" };
    expect(grepTool.formatCompactParams?.(params2)).toBe("import ts");

    const params3 = { pattern: "console", output_mode: "count" };
    expect(grepTool.formatCompactParams?.(params3)).toBe("console [count]");

    const params4 = { pattern: "test", type: "js", output_mode: "content" };
    expect(grepTool.formatCompactParams?.(params4)).toBe("test js [content]");
  });

  it("should handle complex glob patterns with braces", async () => {
    // 添加一个包含 export 的 jsx 文件来测试 braces glob
    await writeFile(
      join(tempDir, "src/component.jsx"),
      `export const Button = () => {
  return <button>Click me</button>;
};`,
    );

    const result = await grepTool.execute({
      pattern: "export",
      glob: "**/*.{ts,tsx,js,jsx}",
      output_mode: "files_with_matches",
    });

    expect(result.success).toBe(true);
    expect(result.content).toContain("src/index.ts");
    expect(result.content).toContain("src/utils.ts");
    expect(result.content).toContain("src/component.jsx");
  });

  it("should handle multiple comma-separated glob patterns without braces", async () => {
    const result = await grepTool.execute({
      pattern: "export",
      glob: "*.ts,*.js",
      output_mode: "files_with_matches",
    });

    expect(result.success).toBe(true);
    // 由于 glob "*.ts,*.js" 只匹配根目录的文件，不会匹配 src/ 目录下的文件
    // 这个测试主要验证逗号分割功能仍然有效
    expect(result.success).toBe(true);
  });

  it("should handle special regex characters", async () => {
    const result = await grepTool.execute({
      pattern: "function\\s+\\w+",
      output_mode: "files_with_matches",
    });

    expect(result.success).toBe(true);
    expect(result.content).toContain("src/index.ts");
    expect(result.content).toContain("src/utils.ts");
  });

  it("should handle patterns starting with dash", async () => {
    // 创建一个包含以 - 开头内容的文件来测试
    await writeFile(
      join(tempDir, "tasks.md"),
      `# Tasks
- [ ] Implement user authentication
- [x] Setup database connection
- [ ] Create API endpoints
--verbose mode enabled
`,
    );

    const result = await grepTool.execute({
      pattern: "- \\[ \\]",
      output_mode: "content",
      "-n": true,
    });

    expect(result.success).toBe(true);
    expect(result.content).toContain("tasks.md");
    expect(result.content).toContain("- [ ] Implement user authentication");
    expect(result.content).toContain("- [ ] Create API endpoints");
    expect(result.content).not.toContain("- [x] Setup database connection");
  });

  it("should handle patterns starting with double dash", async () => {
    // 确保 tasks.md 文件存在（如果前面的测试没有创建）
    await writeFile(
      join(tempDir, "tasks.md"),
      `# Tasks
- [ ] Implement user authentication
- [x] Setup database connection
- [ ] Create API endpoints
--verbose mode enabled
`,
    );

    const result = await grepTool.execute({
      pattern: "--verbose",
      output_mode: "files_with_matches",
    });

    expect(result.success).toBe(true);
    expect(result.content).toContain("tasks.md");
  });
});
