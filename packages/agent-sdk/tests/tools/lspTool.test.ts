import { describe, it, expect, vi, beforeEach } from "vitest";
import { lspTool } from "../../src/tools/lspTool.js";
import { TaskManager } from "../../src/services/taskManager.js";
import { ToolContext } from "../../src/tools/types.js";

describe("lspTool", () => {
  const mockLspManager = {
    execute: vi.fn(),
  };

  const context: ToolContext = {
    workdir: "/test/workdir",
    taskManager: new TaskManager("test-session"),
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

  it("should call LspManager and format goToDefinition result", async () => {
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
    expect(mockLspManager.execute).toHaveBeenCalledWith({
      operation: "goToDefinition",
      filePath: "src/main.ts",
      line: 5,
      character: 10,
    });
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

  it("should handle LspManager failure", async () => {
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

  it("should return error if LspManager is not available", async () => {
    const result = await lspTool.execute(
      {
        operation: "hover",
        filePath: "src/main.ts",
        line: 5,
        character: 3,
      },
      { ...context, lspManager: undefined },
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("LSP manager not available in tool context");
  });

  it("should format findReferences result", async () => {
    const mockLspResult = [
      {
        uri: "file:///test/workdir/src/index.ts",
        range: {
          start: { line: 10, character: 5 },
          end: { line: 10, character: 15 },
        },
      },
    ];

    mockLspManager.execute.mockResolvedValue({
      success: true,
      content: JSON.stringify(mockLspResult),
    });

    const result = await lspTool.execute(
      {
        operation: "findReferences",
        filePath: "src/main.ts",
        line: 5,
        character: 10,
      },
      context,
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("Found 1 reference:");
    expect(result.content).toContain("src/index.ts:11:6");
  });

  it("should format documentSymbol result", async () => {
    const mockLspResult = [
      {
        name: "MyClass",
        kind: 5, // Class
        range: {
          start: { line: 0, character: 0 },
          end: { line: 10, character: 0 },
        },
        selectionRange: {
          start: { line: 0, character: 0 },
          end: { line: 10, character: 0 },
        },
        children: [
          {
            name: "myMethod",
            kind: 6, // Method
            range: {
              start: { line: 2, character: 4 },
              end: { line: 5, character: 4 },
            },
            selectionRange: {
              start: { line: 2, character: 4 },
              end: { line: 5, character: 4 },
            },
          },
        ],
      },
    ];

    mockLspManager.execute.mockResolvedValue({
      success: true,
      content: JSON.stringify(mockLspResult),
    });

    const result = await lspTool.execute(
      {
        operation: "documentSymbol",
        filePath: "src/main.ts",
        line: 1,
        character: 1,
      },
      context,
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("MyClass (Class) - Line 1");
    expect(result.content).toContain("  myMethod (Method) - Line 3");
  });

  it("should format workspaceSymbol result", async () => {
    const mockLspResult = [
      {
        name: "GlobalVar",
        kind: 13, // Variable
        location: {
          uri: "file:///test/workdir/src/globals.ts",
          range: {
            start: { line: 5, character: 0 },
            end: { line: 5, character: 10 },
          },
        },
      },
    ];

    mockLspManager.execute.mockResolvedValue({
      success: true,
      content: JSON.stringify(mockLspResult),
    });

    const result = await lspTool.execute(
      {
        operation: "workspaceSymbol",
        filePath: "",
        line: 0,
        character: 0,
      },
      context,
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("Found 1 symbol in workspace:");
    expect(result.content).toContain("src/globals.ts:");
    expect(result.content).toContain("GlobalVar (Variable) - Line 6");
  });

  it("should format call hierarchy results", async () => {
    // prepareCallHierarchy
    const mockPrepareResult = [
      {
        name: "myFunc",
        kind: 12,
        uri: "file:///test/workdir/src/main.ts",
        range: {
          start: { line: 10, character: 0 },
          end: { line: 10, character: 10 },
        },
        selectionRange: {
          start: { line: 10, character: 0 },
          end: { line: 10, character: 10 },
        },
      },
    ];

    mockLspManager.execute.mockResolvedValueOnce({
      success: true,
      content: JSON.stringify(mockPrepareResult),
    });

    const prepareResult = await lspTool.execute(
      {
        operation: "prepareCallHierarchy",
        filePath: "src/main.ts",
        line: 11,
        character: 1,
      },
      context,
    );
    expect(prepareResult.success).toBe(true);
    expect(prepareResult.content).toContain(
      "Call hierarchy item: myFunc (Function) - src/main.ts:11",
    );

    // incomingCalls
    const mockIncomingResult = [
      {
        from: {
          name: "caller",
          kind: 12,
          uri: "file:///test/workdir/src/other.ts",
          range: {
            start: { line: 5, character: 0 },
            end: { line: 5, character: 10 },
          },
          selectionRange: {
            start: { line: 5, character: 0 },
            end: { line: 5, character: 10 },
          },
        },
        fromRanges: [
          { start: { line: 6, character: 5 }, end: { line: 6, character: 10 } },
        ],
      },
    ];

    mockLspManager.execute.mockResolvedValueOnce({
      success: true,
      content: JSON.stringify(mockIncomingResult),
    });

    const incomingResult = await lspTool.execute(
      {
        operation: "incomingCalls",
        filePath: "src/main.ts",
        line: 11,
        character: 1,
      },
      context,
    );
    expect(incomingResult.success).toBe(true);
    expect(incomingResult.content).toContain("Found 1 incoming call:");
    expect(incomingResult.content).toContain(
      "caller (Function) - Line 6 [calls at: 7:6]",
    );

    // outgoingCalls
    const mockOutgoingResult = [
      {
        to: {
          name: "callee",
          kind: 12,
          uri: "file:///test/workdir/src/lib.ts",
          range: {
            start: { line: 20, character: 0 },
            end: { line: 20, character: 10 },
          },
          selectionRange: {
            start: { line: 20, character: 0 },
            end: { line: 20, character: 10 },
          },
        },
        fromRanges: [
          {
            start: { line: 12, character: 5 },
            end: { line: 12, character: 10 },
          },
        ],
      },
    ];

    mockLspManager.execute.mockResolvedValueOnce({
      success: true,
      content: JSON.stringify(mockOutgoingResult),
    });

    const outgoingResult = await lspTool.execute(
      {
        operation: "outgoingCalls",
        filePath: "src/main.ts",
        line: 11,
        character: 1,
      },
      context,
    );
    expect(outgoingResult.success).toBe(true);
    expect(outgoingResult.content).toContain("Found 1 outgoing call:");
    expect(outgoingResult.content).toContain(
      "callee (Function) - Line 21 [called from: 13:6]",
    );
  });

  it("should handle empty results for various operations", async () => {
    mockLspManager.execute.mockResolvedValue({
      success: true,
      content: JSON.stringify([]),
    });

    const operations = [
      "findReferences",
      "documentSymbol",
      "workspaceSymbol",
      "prepareCallHierarchy",
      "incomingCalls",
      "outgoingCalls",
    ];

    for (const operation of operations) {
      const result = await lspTool.execute(
        { operation, filePath: "src/main.ts", line: 1, character: 1 },
        context,
      );
      expect(result.success).toBe(true);
      expect(result.content).toMatch(/No .* found/i);
    }
  });

  it("should handle malformed JSON or unexpected errors", async () => {
    mockLspManager.execute.mockResolvedValue({
      success: true,
      content: "not json",
    });

    const result = await lspTool.execute(
      { operation: "hover", filePath: "src/main.ts", line: 1, character: 1 },
      context,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("LSP operation failed");
  });

  it("should format compact params", () => {
    const params = {
      operation: "hover",
      filePath: "src/main.ts",
      line: 10,
      character: 5,
    };
    const result = lspTool.formatCompactParams?.(params, context);
    expect(result).toBe("hover src/main.ts:10:5");
  });

  it("should handle LocationLink in goToDefinition", async () => {
    const mockLspResult = {
      targetUri: "file:///test/workdir/src/link.ts",
      targetRange: {
        start: { line: 5, character: 0 },
        end: { line: 5, character: 10 },
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
        line: 1,
        character: 1,
      },
      context,
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("Defined in src/link.ts:6:1");
  });

  it("should handle hover with array contents", async () => {
    const mockLspResult = {
      contents: ["Line 1", { language: "ts", value: "Line 2" }],
    };

    mockLspManager.execute.mockResolvedValue({
      success: true,
      content: JSON.stringify(mockLspResult),
    });

    const result = await lspTool.execute(
      { operation: "hover", filePath: "src/main.ts", line: 1, character: 1 },
      context,
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("Line 1\n\nLine 2");
  });

  it("should handle hover with MarkupContent", async () => {
    const mockLspResult = {
      contents: { kind: "markdown", value: "### Header" },
    };

    mockLspManager.execute.mockResolvedValue({
      success: true,
      content: JSON.stringify(mockLspResult),
    });

    const result = await lspTool.execute(
      { operation: "hover", filePath: "src/main.ts", line: 1, character: 1 },
      context,
    );

    expect(result.success).toBe(true);
    expect(result.content).toBe("### Header");
  });

  it("should handle SymbolInformation in documentSymbol", async () => {
    const mockLspResult = [
      {
        name: "GlobalSym",
        kind: 12,
        location: {
          uri: "file:///test/workdir/src/main.ts",
          range: {
            start: { line: 10, character: 0 },
            end: { line: 10, character: 10 },
          },
        },
      },
    ];

    mockLspManager.execute.mockResolvedValue({
      success: true,
      content: JSON.stringify(mockLspResult),
    });

    const result = await lspTool.execute(
      {
        operation: "documentSymbol",
        filePath: "src/main.ts",
        line: 1,
        character: 1,
      },
      context,
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("GlobalSym (Function) - Line 11");
  });
});
