import { describe, it, expect, vi, beforeEach } from "vitest";
import { searchFiles } from "../../src/utils/fileSearch.js";
import { spawn } from "child_process";
import { EventEmitter } from "events";

// Mock child_process.spawn
vi.mock("child_process", () => ({
  spawn: vi.fn(),
}));

// Mock ripgrep utility
vi.mock("../../src/utils/ripgrep.js", () => ({
  rgPath: "/mock/path/to/rg",
}));

// Mock fs to avoid reading real .gitignore files
vi.mock("fs", async () => {
  const actual = await vi.importActual("fs");
  return {
    ...actual,
    readdirSync: vi.fn().mockReturnValue([]),
    existsSync: vi.fn().mockReturnValue(false),
    readFileSync: vi.fn().mockReturnValue(""),
  };
});

describe("searchFiles", () => {
  const mockFiles = [
    "src/index.ts",
    "src/utils/fileSearch.ts",
    "packages/agent-sdk/src/index.ts",
    "README.md",
    "package.json",
    "node_modules/some-pkg/index.js",
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const setupMockSpawn = (files: string[], exitCode = 0) => {
    vi.mocked(spawn).mockImplementation(() => {
      const mockStdout = new EventEmitter();
      const mockStderr = new EventEmitter();
      const mockProcess = new EventEmitter() as unknown as ReturnType<
        typeof spawn
      >;

      Object.defineProperty(mockProcess, "stdout", { value: mockStdout });
      Object.defineProperty(mockProcess, "stderr", { value: mockStderr });

      // Simulate ripgrep output
      setTimeout(() => {
        mockStdout.emit("data", Buffer.from(files.join("\n")));
        mockProcess.emit("close", exitCode);
      }, 10);

      return mockProcess;
    });
  };

  it("should perform fuzzy matching", async () => {
    setupMockSpawn([...mockFiles, "abc.ts"]);

    // 'srcidx' should match 'src/index.ts'
    const results = await searchFiles("srcidx");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].path).toContain("src/index.ts");
    expect(results[0].type).toBe("file");

    // 'fsh' for 'fileSearch.ts'
    const results2 = await searchFiles("fsh");
    expect(results2.some((r) => r.path.includes("fileSearch.ts"))).toBe(true);

    // 'acb' should match 'a/c/b.ts' (characters in order)
    setupMockSpawn([...mockFiles, "a/c/b.ts"]);
    const results3 = await searchFiles("acb");
    expect(results3.some((r) => r.path.includes("a/c/b.ts"))).toBe(true);
  });

  it("should respect ignore patterns (ripgrep respects .gitignore by default)", async () => {
    setupMockSpawn(mockFiles);

    await searchFiles("some-pkg");

    // Check if spawn was called with correct arguments
    expect(spawn).toHaveBeenCalledWith(
      "/mock/path/to/rg",
      expect.arrayContaining(["--files", "--color=never", "--hidden"]),
      expect.any(Object),
    );
  });

  it("should handle empty queries by showing common file types and top-level directories", async () => {
    setupMockSpawn(mockFiles);

    const results = await searchFiles("");

    // Should include top-level directories
    expect(results).toContainEqual({ path: "src/", type: "directory" });
    expect(results).toContainEqual({ path: "packages/", type: "directory" });

    // Should include common file types (ts, json)
    expect(results).toContainEqual({ path: "src/index.ts", type: "file" });
    expect(results).toContainEqual({ path: "package.json", type: "file" });
  });

  it("should derive directories correctly", async () => {
    setupMockSpawn(["a/b/c.ts"]);

    // Search for 'a/b/'
    const results = await searchFiles("a/b/");
    // 'a/b/' should match 'a/b/' directory and 'a/b/c.ts' file
    expect(results).toContainEqual({ path: "a/b/", type: "directory" });
    expect(results).toContainEqual({ path: "a/b/c.ts", type: "file" });
  });

  it("should normalize paths to forward slashes", async () => {
    // Simulate Windows-style paths from ripgrep
    setupMockSpawn(["src\\utils\\fileSearch.ts"]);

    const results = await searchFiles("fileSearch");
    expect(results[0].path).toBe("src/utils/fileSearch.ts");
  });

  it("should respect maxResults option", async () => {
    setupMockSpawn(mockFiles);

    const results = await searchFiles("", { maxResults: 2 });
    expect(results.length).toBe(2);
  });

  it("should exclude .git and .DS_Store files", async () => {
    setupMockSpawn([
      ".git",
      ".git/config",
      "src/.git/something",
      ".DS_Store",
      "src/.DS_Store",
      "src/index.ts",
    ]);

    const results = await searchFiles("git");
    expect(results.some((r) => r.path.includes(".git"))).toBe(false);

    const results2 = await searchFiles("DS_Store");
    expect(results2.some((r) => r.path.includes(".DS_Store"))).toBe(false);

    const results3 = await searchFiles("");
    expect(results3.some((r) => r.path.includes(".git"))).toBe(false);
    expect(results3.some((r) => r.path.includes(".DS_Store"))).toBe(false);
  });

  it("should handle ripgrep failure gracefully", async () => {
    const mockStdout = new EventEmitter();
    const mockStderr = new EventEmitter();
    const mockProcess = new EventEmitter() as unknown as ReturnType<
      typeof spawn
    >;
    Object.defineProperty(mockProcess, "stdout", { value: mockStdout });
    Object.defineProperty(mockProcess, "stderr", { value: mockStderr });

    vi.mocked(spawn).mockReturnValue(mockProcess);

    setTimeout(() => {
      mockStderr.emit("data", Buffer.from("some error"));
      mockProcess.emit("close", 1); // ripgrep returns 1 if no matches, but here we test other failures
    }, 10);

    // Actually, the code handles code 1 as success (no matches)
    // Let's test code 2
    const mockProcess2 = new EventEmitter() as unknown as ReturnType<
      typeof spawn
    >;
    const mockStdout2 = new EventEmitter();
    const mockStderr2 = new EventEmitter();
    Object.defineProperty(mockProcess2, "stdout", { value: mockStdout2 });
    Object.defineProperty(mockProcess2, "stderr", { value: mockStderr2 });
    vi.mocked(spawn).mockReturnValue(mockProcess2);
    setTimeout(() => {
      mockStderr2.emit("data", Buffer.from("fatal error"));
      mockProcess2.emit("close", 2);
    }, 10);

    const results = await searchFiles("query");
    expect(results).toEqual([]);
  });
});
