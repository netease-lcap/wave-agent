import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { grepTool } from "@/tools/grepTool.js";
import type { ToolContext } from "@/tools/types.js";
import type { ChildProcess } from "child_process";

const testContext: ToolContext = { workdir: "/test/workdir" };

// Mock child_process
vi.mock("child_process", () => ({
  spawn: vi.fn(),
}));

// Mock ripgrep path
vi.mock("@vscode/ripgrep", () => ({
  rgPath: "/mock/rg",
}));

// Mock utilities
vi.mock("../utils/fileFilter.js", () => ({
  getGlobIgnorePatterns: vi.fn(() => ["**/node_modules/**", "**/.git/**"]),
}));

vi.mock("../utils/path.js", () => ({
  getDisplayPath: vi.fn((path: string) => path.replace("/test/workdir/", "")),
}));

// Import the mocked modules
import { spawn } from "child_process";

describe("grepTool", () => {
  const mockSpawn = vi.mocked(spawn);
  // Helper to create a mock spawn process
  const createMockProcess = (
    stdout: string,
    stderr: string = "",
    exitCode: number = 0,
  ): Partial<ChildProcess> => {
    const mockProcess = {
      stdout: {
        on: vi.fn(),
        pipe: vi.fn(),
      } as never,
      stderr: {
        on: vi.fn(),
        pipe: vi.fn(),
      } as never,
      on: vi.fn(),
      kill: vi.fn(),
    } as Partial<ChildProcess>;

    // Simulate data events
    (
      mockProcess.stdout as never as { on: ReturnType<typeof vi.fn> }
    ).on.mockImplementation(
      (event: string, callback: (data: Buffer) => void) => {
        if (event === "data" && stdout) {
          setTimeout(() => callback(Buffer.from(stdout)), 0);
        }
        return mockProcess.stdout;
      },
    );

    (
      mockProcess.stderr as never as { on: ReturnType<typeof vi.fn> }
    ).on.mockImplementation(
      (event: string, callback: (data: Buffer) => void) => {
        if (event === "data" && stderr) {
          setTimeout(() => callback(Buffer.from(stderr)), 0);
        }
        return mockProcess.stderr;
      },
    );

    (mockProcess.on as ReturnType<typeof vi.fn>).mockImplementation(
      (
        event: string,
        callback: ((code: number) => void) | ((error: Error) => void),
      ) => {
        if (event === "close") {
          setTimeout(() => (callback as (code: number) => void)(exitCode), 0);
        } else if (event === "error" && exitCode !== 0 && stderr) {
          setTimeout(
            () => (callback as (error: Error) => void)(new Error(stderr)),
            0,
          );
        }
        return mockProcess;
      },
    );

    return mockProcess;
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
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
    const stdout = "src/index.ts\nsrc/utils.ts\n";
    mockSpawn.mockReturnValueOnce(createMockProcess(stdout) as ChildProcess);

    const result = await grepTool.execute(
      {
        pattern: "export",
        output_mode: "files_with_matches",
      },
      { workdir: "/test/workdir" },
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("src/index.ts");
    expect(result.content).toContain("src/utils.ts");
    expect(result.shortResult).toContain("Found");
  });

  it("should show matching lines (content mode)", async () => {
    const stdout = `src/index.ts:1:export const app = 'main';
src/utils.ts:1:export const logger = {};
`;
    mockSpawn.mockReturnValueOnce(createMockProcess(stdout) as ChildProcess);

    const result = await grepTool.execute(
      {
        pattern: "export const",
        output_mode: "content",
      },
      { workdir: "/test/workdir" },
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("src/index.ts");
    expect(result.content).toContain("export const app");
    expect(result.content).toContain("src/utils.ts");
    expect(result.content).toContain("export const logger");
  });

  it("should show match counts (count mode)", async () => {
    const stdout = `src/index.ts:2
src/utils.ts:3
`;
    mockSpawn.mockReturnValueOnce(createMockProcess(stdout) as ChildProcess);

    const result = await grepTool.execute(
      {
        pattern: "export",
        output_mode: "count",
      },
      { workdir: "/test/workdir" },
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("src/index.ts:");
    expect(result.content).toContain("src/utils.ts:");
    expect(result.shortResult).toContain("Match counts");
  });

  it("should show line numbers in content mode", async () => {
    const stdout = `src/index.ts:1:export const app = 'main';
src/utils.ts:1:export const logger = {};
`;
    mockSpawn.mockReturnValueOnce(createMockProcess(stdout) as ChildProcess);

    const result = await grepTool.execute(
      {
        pattern: "export const",
        output_mode: "content",
        "-n": true,
      },
      { workdir: "/test/workdir" },
    );

    expect(result.success).toBe(true);
    expect(result.content).toMatch(/src\/index\.ts:\d+:/);
    expect(result.content).toMatch(/src\/utils\.ts:\d+:/);
  });

  it("should work with case insensitive search", async () => {
    const stdout = "src/index.ts\n";
    mockSpawn.mockReturnValueOnce(createMockProcess(stdout) as ChildProcess);

    const result = await grepTool.execute(
      {
        pattern: "APPLICATION",
        "-i": true,
        output_mode: "files_with_matches",
      },
      { workdir: "/test/workdir" },
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("src/index.ts");

    // Verify that the -i flag was passed
    expect(mockSpawn).toHaveBeenCalledWith(
      "/mock/rg",
      expect.arrayContaining(["-i"]),
      expect.any(Object),
    );
  });

  it("should filter by file type", async () => {
    const stdout = "src/index.ts\nsrc/utils.ts\n";
    mockSpawn.mockReturnValueOnce(createMockProcess(stdout) as ChildProcess);

    const result = await grepTool.execute(
      {
        pattern: "export",
        type: "ts",
        output_mode: "files_with_matches",
      },
      { workdir: "/test/workdir" },
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("src/index.ts");
    expect(result.content).toContain("src/utils.ts");
    expect(result.content).not.toContain("tests/app.test.js");

    // Verify that the --type flag was passed
    expect(mockSpawn).toHaveBeenCalledWith(
      "/mock/rg",
      expect.arrayContaining(["--type", "ts"]),
      expect.any(Object),
    );
  });

  it("should filter by glob pattern", async () => {
    const stdout = "src/index.ts\nsrc/utils.ts\n";
    mockSpawn.mockReturnValueOnce(createMockProcess(stdout) as ChildProcess);

    const result = await grepTool.execute(
      {
        pattern: "export",
        glob: "*.ts",
        output_mode: "files_with_matches",
      },
      { workdir: "/test/workdir" },
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("src/index.ts");
    expect(result.content).toContain("src/utils.ts");
    expect(result.content).not.toContain("tests/app.test.js");

    // Verify that the --glob flag was passed
    expect(mockSpawn).toHaveBeenCalledWith(
      "/mock/rg",
      expect.arrayContaining(["--glob", "*.ts"]),
      expect.any(Object),
    );
  });

  it("should show context lines", async () => {
    const stdout = `src/index.ts-1-export const app = 'main';
src/index.ts:2:export function createApp() {
src/index.ts-3-  return new Application();
`;
    mockSpawn.mockReturnValueOnce(createMockProcess(stdout) as ChildProcess);

    const result = await grepTool.execute(
      {
        pattern: "createApp",
        output_mode: "content",
        "-C": 2,
      },
      { workdir: "/test/workdir" },
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("export const app");
    expect(result.content).toContain("export function createApp");
    expect(result.content).toContain("return new Application");

    // Verify that the -C flag was passed
    expect(mockSpawn).toHaveBeenCalledWith(
      "/mock/rg",
      expect.arrayContaining(["-C", "2"]),
      expect.any(Object),
    );
  });

  it("should show context before matches", async () => {
    const stdout = `src/index.ts-1-export const app = 'main';
src/index.ts:2:export function createApp() {
`;
    mockSpawn.mockReturnValueOnce(createMockProcess(stdout) as ChildProcess);

    const result = await grepTool.execute(
      {
        pattern: "createApp",
        output_mode: "content",
        "-B": 1,
      },
      { workdir: "/test/workdir" },
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("export const app");
    expect(result.content).toContain("export function createApp");
  });

  it("should show context after matches", async () => {
    const stdout = `src/index.ts:2:export function createApp() {
src/index.ts-3-  return new Application();
`;
    mockSpawn.mockReturnValueOnce(createMockProcess(stdout) as ChildProcess);

    const result = await grepTool.execute(
      {
        pattern: "createApp",
        output_mode: "content",
        "-A": 1,
      },
      { workdir: "/test/workdir" },
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("export function createApp");
    expect(result.content).toContain("return new Application");
  });

  it("should limit results with head_limit", async () => {
    const stdout = "src/index.ts\nsrc/utils.ts\nsrc/other.ts\n";
    mockSpawn.mockReturnValueOnce(createMockProcess(stdout) as ChildProcess);

    const result = await grepTool.execute(
      {
        pattern: "export",
        output_mode: "files_with_matches",
        head_limit: 1,
      },
      { workdir: "/test/workdir" },
    );

    expect(result.success).toBe(true);
    const lines = result.content.split("\n").filter((line) => line.trim());
    expect(lines.length).toBe(1);
    expect(result.shortResult).toContain("showing first 1");
  });

  it("should work with multiline mode", async () => {
    const stdout = "multiline.txt\n";
    mockSpawn.mockReturnValueOnce(createMockProcess(stdout) as ChildProcess);

    const result = await grepTool.execute(
      {
        pattern: "struct.*name",
        multiline: true,
        output_mode: "files_with_matches",
      },
      { workdir: "/test/workdir" },
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.content).toContain("multiline.txt");
    }

    // Verify that multiline flags were passed
    expect(mockSpawn).toHaveBeenCalledWith(
      "/mock/rg",
      expect.arrayContaining(["-U", "--multiline-dotall"]),
      expect.any(Object),
    );
  });

  it("should search in specific path", async () => {
    const stdout = "src/index.ts\nsrc/utils.ts\n";
    mockSpawn.mockReturnValueOnce(createMockProcess(stdout) as ChildProcess);

    const result = await grepTool.execute(
      {
        pattern: "export",
        path: "src",
        output_mode: "files_with_matches",
      },
      { workdir: "/test/workdir" },
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("src/index.ts");
    expect(result.content).toContain("src/utils.ts");

    // Verify that the path was passed as an argument
    expect(mockSpawn).toHaveBeenCalledWith(
      "/mock/rg",
      expect.arrayContaining(["src"]),
      expect.any(Object),
    );
  });

  it("should return no matches message", async () => {
    // Mock empty output with exit code 1 (no matches found)
    mockSpawn.mockReturnValueOnce(createMockProcess("", "", 1) as ChildProcess);

    const result = await grepTool.execute(
      {
        pattern: "NONEXISTENT_PATTERN_12345",
      },
      { workdir: "/test/workdir" },
    );

    expect(result.success).toBe(true);
    expect(result.content).toBe("No matches found");
    expect(result.shortResult).toBe("No matches found");
  });

  it("should return error for missing pattern", async () => {
    const result = await grepTool.execute({}, testContext);

    expect(result.success).toBe(false);
    expect(result.error).toContain("pattern parameter is required");
  });

  it("should return error for invalid pattern type", async () => {
    const result = await grepTool.execute({ pattern: 123 }, testContext);

    expect(result.success).toBe(false);
    expect(result.error).toContain(
      "pattern parameter is required and must be a string",
    );
  });

  it("should format compact parameters correctly", () => {
    const params1 = { pattern: "export" };
    expect(grepTool.formatCompactParams?.(params1, testContext)).toBe("export");

    const params2 = { pattern: "import", type: "ts" };
    expect(grepTool.formatCompactParams?.(params2, testContext)).toBe(
      "import ts",
    );

    const params3 = { pattern: "console", output_mode: "count" };
    expect(grepTool.formatCompactParams?.(params3, testContext)).toBe(
      "console [count]",
    );

    const params4 = { pattern: "test", type: "js", output_mode: "content" };
    expect(grepTool.formatCompactParams?.(params4, testContext)).toBe(
      "test js [content]",
    );
  });

  it("should handle complex glob patterns with braces", async () => {
    const stdout = "src/index.ts\nsrc/utils.ts\nsrc/component.jsx\n";
    mockSpawn.mockReturnValueOnce(createMockProcess(stdout) as ChildProcess);

    const result = await grepTool.execute(
      {
        pattern: "export",
        glob: "**/*.{ts,tsx,js,jsx}",
        output_mode: "files_with_matches",
      },
      { workdir: "/test/workdir" },
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("src/index.ts");
    expect(result.content).toContain("src/utils.ts");
    expect(result.content).toContain("src/component.jsx");
  });

  it("should handle special regex characters", async () => {
    const stdout = "src/index.ts\nsrc/utils.ts\n";
    mockSpawn.mockReturnValueOnce(createMockProcess(stdout) as ChildProcess);

    const result = await grepTool.execute(
      {
        pattern: "function\\s+\\w+",
        output_mode: "files_with_matches",
      },
      { workdir: "/test/workdir" },
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("src/index.ts");
    expect(result.content).toContain("src/utils.ts");
  });

  it("should handle patterns starting with dash", async () => {
    const stdout = `tasks.md:2:- [ ] Implement user authentication
tasks.md:4:- [ ] Create API endpoints
`;
    mockSpawn.mockReturnValueOnce(createMockProcess(stdout) as ChildProcess);

    const result = await grepTool.execute(
      {
        pattern: "- \\[ \\]",
        output_mode: "content",
        "-n": true,
      },
      { workdir: "/test/workdir" },
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("tasks.md");
    expect(result.content).toContain("- [ ] Implement user authentication");
    expect(result.content).toContain("- [ ] Create API endpoints");
    expect(result.content).not.toContain("- [x] Setup database connection");
  });

  it("should handle patterns starting with double dash", async () => {
    const stdout = "tasks.md\n";
    mockSpawn.mockReturnValueOnce(createMockProcess(stdout) as ChildProcess);

    const result = await grepTool.execute(
      {
        pattern: "--verbose",
        output_mode: "files_with_matches",
      },
      { workdir: "/test/workdir" },
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("tasks.md");
  });

  it("should handle ripgrep process errors", async () => {
    const mockErrorProcess: Partial<ChildProcess> = {
      stdout: { on: vi.fn(), pipe: vi.fn() } as never,
      stderr: { on: vi.fn(), pipe: vi.fn() } as never,
      on: vi.fn(),
      kill: vi.fn(),
    };

    // Simulate process error
    (mockErrorProcess.on as ReturnType<typeof vi.fn>).mockImplementation(
      (event: string, callback: (error: Error) => void) => {
        if (event === "error") {
          setTimeout(() => callback(new Error("ripgrep not found")), 0);
        }
        return mockErrorProcess;
      },
    );

    mockSpawn.mockReturnValueOnce(mockErrorProcess as ChildProcess);

    const result = await grepTool.execute(
      {
        pattern: "test",
      },
      { workdir: "/test/workdir" },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("ripgrep not found");
  });
});
