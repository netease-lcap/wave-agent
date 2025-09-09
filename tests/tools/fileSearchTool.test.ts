import { describe, it, expect } from "vitest";
import { fileSearchTool } from "../../src/tools/fileSearchTool";
import type { FileTreeNode } from "../../src/types/common";
import type { ToolContext } from "../../src/tools/types";

describe("fileSearchTool", () => {
  const mockFiles: FileTreeNode[] = [
    {
      path: "src/components/ToolResultDisplay.tsx",
      label: "ToolResultDisplay.tsx",
      children: [],
    },
    {
      path: "tests/components/ToolResultDisplay.test.tsx",
      label: "ToolResultDisplay.test.tsx",
      children: [],
    },
    {
      path: "src/components/CommandOutputDisplay.tsx",
      label: "CommandOutputDisplay.tsx",
      children: [],
    },
    {
      path: "tests/components/ToolResultDisplay.compactParams.test.tsx",
      label: "ToolResultDisplay.compactParams.test.tsx",
      children: [],
    },
    {
      path: "src/utils/resultProcessor.ts",
      label: "resultProcessor.ts",
      children: [],
    },
    { path: "docs/tool-guide.md", label: "tool-guide.md", children: [] },
    {
      path: "src/tools/fileSearchTool.ts",
      label: "fileSearchTool.ts",
      children: [],
    },
    { path: "package.json", label: "package.json", children: [] },
    { path: "README.md", label: "README.md", children: [] },
  ];

  const mockContext: ToolContext = {
    flatFiles: mockFiles,
  };

  it("should find files with single keyword", async () => {
    const result = await fileSearchTool.execute({ query: "tool" }, mockContext);

    expect(result.success).toBe(true);
    expect(result.content).toContain("ToolResultDisplay.tsx");
    expect(result.content).toContain("fileSearchTool.ts");
  });

  it("should find files with space-separated keywords", async () => {
    const result = await fileSearchTool.execute(
      { query: "result tool" },
      mockContext,
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("ToolResultDisplay.tsx");
  });

  it("should support out-of-order keyword matching", async () => {
    const result = await fileSearchTool.execute(
      { query: "display result" },
      mockContext,
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("ToolResultDisplay.tsx");
  });

  it("should handle case-insensitive queries", async () => {
    const result = await fileSearchTool.execute(
      { query: "TOOL RESULT" },
      mockContext,
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("ToolResultDisplay.tsx");
  });

  it("should handle queries with multiple spaces", async () => {
    const result = await fileSearchTool.execute(
      { query: "result   tool   display" },
      mockContext,
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("ToolResultDisplay.tsx");
  });

  it('should return "No matching files found" for unmatched queries', async () => {
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
    const manyFiles: FileTreeNode[] = Array.from({ length: 20 }, (_, i) => ({
      path: `src/tool-${i}.ts`,
      label: `tool-${i}.ts`,
      children: [],
    }));

    const largeContext: ToolContext = {
      flatFiles: manyFiles,
    };

    const result = await fileSearchTool.execute(
      { query: "tool" },
      largeContext,
    );

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

  it("should return error when context is missing", async () => {
    const result = await fileSearchTool.execute({ query: "test" });

    expect(result.success).toBe(false);
    expect(result.error).toContain("File context not available");
  });

  it("should return error when flatFiles is missing from context", async () => {
    const result = await fileSearchTool.execute(
      { query: "test" },
      {}, // Empty context without flatFiles
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("File context not available");
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
