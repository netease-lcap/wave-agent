import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fileSearchTool } from "../../src/tools/fileSearchTool";
import type { ToolContext } from "../../src/tools/types";
import { glob } from "glob";

// Mock glob
vi.mock("glob", () => ({
  glob: vi.fn(),
}));

const mockGlob = vi.mocked(glob);

describe("fileSearchTool", () => {
  const mockContext: ToolContext = {
    workdir: "/test/workspace",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("should find files with single keyword", async () => {
    mockGlob.mockResolvedValue([
      "src/components/ToolResultDisplay.tsx",
      "src/tools/fileSearchTool.ts",
      "docs/tool-guide.md",
    ]);

    const result = await fileSearchTool.execute({ query: "tool" }, mockContext);

    expect(result.success).toBe(true);
    expect(result.content).toContain("ToolResultDisplay.tsx");
    expect(result.content).toContain("fileSearchTool.ts");
  });

  it("should find files with space-separated keywords", async () => {
    // Mock multiple glob calls for "result tool" - each call returns files matching individual terms
    mockGlob
      .mockResolvedValueOnce([
        "src/components/ToolResultDisplay.tsx",
        "src/utils/resultProcessor.ts",
      ]) // *result*
      .mockResolvedValueOnce([
        "src/components/ToolResultDisplay.tsx",
        "src/tools/fileSearchTool.ts",
        "docs/tool-guide.md",
      ]); // *tool*

    const result = await fileSearchTool.execute(
      { query: "result tool" },
      mockContext,
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("ToolResultDisplay.tsx");
  });

  it("should support out-of-order keyword matching", async () => {
    mockGlob
      .mockResolvedValueOnce([
        "src/components/ToolResultDisplay.tsx",
        "src/components/CommandOutputDisplay.tsx",
      ]) // *display*
      .mockResolvedValueOnce([
        "src/components/ToolResultDisplay.tsx",
        "src/utils/resultProcessor.ts",
      ]); // *result*

    const result = await fileSearchTool.execute(
      { query: "display result" },
      mockContext,
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("ToolResultDisplay.tsx");
  });

  it("should handle case-insensitive queries", async () => {
    mockGlob
      .mockResolvedValueOnce([
        "src/components/ToolResultDisplay.tsx",
        "src/tools/fileSearchTool.ts",
      ]) // *tool*
      .mockResolvedValueOnce([
        "src/components/ToolResultDisplay.tsx",
        "src/utils/resultProcessor.ts",
      ]); // *result*

    const result = await fileSearchTool.execute(
      { query: "TOOL RESULT" },
      mockContext,
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("ToolResultDisplay.tsx");
  });

  it("should handle queries with multiple spaces", async () => {
    mockGlob
      .mockResolvedValueOnce([
        "src/components/ToolResultDisplay.tsx",
        "src/utils/resultProcessor.ts",
      ]) // *result*
      .mockResolvedValueOnce([
        "src/components/ToolResultDisplay.tsx",
        "src/tools/fileSearchTool.ts",
      ]) // *tool*
      .mockResolvedValueOnce([
        "src/components/ToolResultDisplay.tsx",
        "src/components/CommandOutputDisplay.tsx",
      ]); // *display*

    const result = await fileSearchTool.execute(
      { query: "result   tool   display" },
      mockContext,
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("ToolResultDisplay.tsx");
  });

  it('should return "No matching files found" for unmatched queries', async () => {
    mockGlob.mockResolvedValue([]);

    const result = await fileSearchTool.execute(
      { query: "nonexistent missing" },
      mockContext,
    );

    expect(result.success).toBe(true);
    expect(result.content).toBe("No matching files found");
    expect(result.shortResult).toBe("No files found");
  });

  it("should limit results to 10 items", async () => {
    // Create a large list of files to test the limit
    const manyFiles = Array.from({ length: 20 }, (_, i) => `src/tool-${i}.ts`);
    mockGlob.mockResolvedValue(manyFiles);

    const result = await fileSearchTool.execute({ query: "tool" }, mockContext);

    expect(result.success).toBe(true);
    const lines = result.content.split("\n").filter((line) => line.trim());
    expect(lines.length).toBeLessThanOrEqual(10);
    expect(result.shortResult).toContain("(top 10)");
  });

  it("should return error for missing query parameter", async () => {
    const result = await fileSearchTool.execute({}, mockContext);

    expect(result.success).toBe(false);
    expect(result.error).toContain("query parameter is required");
  });

  it("should return error for invalid query parameter", async () => {
    const result = await fileSearchTool.execute({ query: 123 }, mockContext);

    expect(result.success).toBe(false);
    expect(result.error).toContain(
      "query parameter is required and must be a string",
    );
  });

  it("should handle empty or whitespace-only queries", async () => {
    const result = await fileSearchTool.execute({ query: "   " }, mockContext);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Query cannot be empty");
  });

  it("should work without context", async () => {
    mockGlob.mockResolvedValue(["test-file.ts"]);

    const result = await fileSearchTool.execute({ query: "test" });

    expect(result.success).toBe(true);
    expect(result.content).toContain("test-file.ts");
  });

  it("should format compact params correctly", () => {
    const formatted = fileSearchTool.formatCompactParams!({
      query: "test search",
    });
    expect(formatted).toBe("test search");
  });

  it("should handle empty query in formatCompactParams", () => {
    const formatted = fileSearchTool.formatCompactParams!({});
    expect(formatted).toBe("");
  });
});
