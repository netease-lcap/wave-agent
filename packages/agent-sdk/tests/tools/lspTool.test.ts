import { describe, it, expect, vi, beforeEach } from "vitest";
import { lspTool } from "../../src/tools/lspTool.js";
import { ToolContext } from "../../src/tools/types.js";

describe("lspTool", () => {
  const mockLspManager = {
    execute: vi.fn(),
  };

  const context: ToolContext = {
    workdir: "/test/workdir",
    lspManager: mockLspManager as unknown as ToolContext["lspManager"],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should have the correct name and config", () => {
    expect(lspTool.name).toBe("LSP");
    expect(lspTool.config.function.name).toBe("LSP");
    expect(
      (lspTool.config.function.parameters as Record<string, unknown>).required,
    ).toContain("operation");
  });

  it("should call LSP manager and format goToDefinition result", async () => {
    const mockLspResult = {
      uri: "file:///test/workdir/src/index.ts",
      range: {
        start: { line: 10, character: 5 },
        end: { line: 10, character: 15 },
      },
    };

    mockLspManager.execute.mockResolvedValue({
      success: true,
      content: JSON.stringify(mockLspResult),
    });

    const result = await lspTool.execute(
      {
        operation: "goToDefinition",
        filePath: "src/main.ts",
        line: 5,
        character: 10,
      },
      context,
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("Defined in src/index.ts:11:6");
    expect(mockLspManager.execute).toHaveBeenCalledWith(
      {
        operation: "goToDefinition",
        filePath: "src/main.ts",
        line: 5,
        character: 10,
      },
      undefined,
    );
  });

  it("should handle multiple definitions", async () => {
    const mockLspResult = [
      {
        uri: "file:///test/workdir/src/index.ts",
        range: {
          start: { line: 10, character: 5 },
          end: { line: 10, character: 15 },
        },
      },
      {
        uri: "file:///test/workdir/src/other.ts",
        range: {
          start: { line: 20, character: 0 },
          end: { line: 20, character: 10 },
        },
      },
    ];

    mockLspManager.execute.mockResolvedValue({
      success: true,
      content: JSON.stringify(mockLspResult),
    });

    const result = await lspTool.execute(
      {
        operation: "goToDefinition",
        filePath: "src/main.ts",
        line: 5,
        character: 10,
      },
      context,
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("Found 2 definitions:");
    expect(result.content).toContain("src/index.ts:11:6");
    expect(result.content).toContain("src/other.ts:21:1");
  });

  it("should format hover result", async () => {
    const mockLspResult = {
      contents: "This is a hover message",
      range: {
        start: { line: 4, character: 2 },
        end: { line: 4, character: 10 },
      },
    };

    mockLspManager.execute.mockResolvedValue({
      success: true,
      content: JSON.stringify(mockLspResult),
    });

    const result = await lspTool.execute(
      {
        operation: "hover",
        filePath: "src/main.ts",
        line: 5,
        character: 3,
      },
      context,
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("Hover info at 5:3:");
    expect(result.content).toContain("This is a hover message");
  });

  it("should handle LSP manager failure", async () => {
    mockLspManager.execute.mockResolvedValue({
      success: false,
      content: "LSP server not found",
    });

    const result = await lspTool.execute(
      {
        operation: "hover",
        filePath: "src/main.ts",
        line: 5,
        character: 3,
      },
      context,
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("LSP server not found");
  });
});
