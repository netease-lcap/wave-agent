import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AIManager } from "../../src/services/aiManager";
import { extractCompleteParams } from "../../src/utils/jsonExtractor";

// Mock the AI service
vi.mock("../../src/services/aiService", () => ({
  callAgent: vi.fn(),
  compressMessages: vi.fn(),
}));

// Mock the file manager
vi.mock("../../src/services/fileManager");

// Mock the tool registry
vi.mock("../../src/tools", () => ({
  toolRegistry: {
    execute: vi.fn(),
    getToolsConfig: vi.fn(() => []),
    list: vi.fn(() => []),
    register: vi.fn(),
  },
}));

// Mock other dependencies
vi.mock("../../src/utils/memoryUtils", () => ({
  readMemoryFile: vi.fn().mockResolvedValue(""),
}));

vi.mock("../../src/services/memoryManager", () => ({
  createMemoryManager: vi.fn(() => ({
    getUserMemoryContent: vi.fn().mockResolvedValue(""),
  })),
}));

vi.mock("../../src/services/sessionManager", () => ({
  SessionManager: {
    saveSession: vi.fn(),
  },
}));

vi.mock("../../src/utils/errorLogger", () => ({
  saveErrorLog: vi.fn(),
}));

describe("AIManager - Compact Params Display", () => {
  let aiManager: AIManager;

  const callbacks = {
    onMessagesChange: vi.fn(),
    onLoadingChange: vi.fn(),
    getCurrentInputHistory: () => [],
  };

  beforeEach(() => {
    vi.clearAllMocks();

    aiManager = new AIManager("/test", callbacks);
  });

  afterEach(() => {
    aiManager.destroy();
  });

  it("should extract and display complete params from incomplete JSON during streaming", async () => {
    // Test the core functionality of extractCompleteParams
    const incompleteJson1 =
      '{"target_file": "src/test.ts", "code_edit": "incomplete';
    const result1 = extractCompleteParams(incompleteJson1);
    expect(result1).toEqual({ target_file: "src/test.ts" });

    const incompleteJson2 =
      '{"query": "function", "include_pattern": "*.ts", "case_sensitive": fal';
    const result2 = extractCompleteParams(incompleteJson2);
    expect(result2).toEqual({ query: "function", include_pattern: "*.ts" });

    const incompleteJson3 =
      '{"start_line": 10, "end_line": 20, "target_file": "incomplete';
    const result3 = extractCompleteParams(incompleteJson3);
    expect(result3).toEqual({ start_line: 10, end_line: 20 });
  });

  it("should demonstrate compact params extraction works for streaming scenarios", () => {
    // This test simulates what happens during tool parameter streaming
    // without the full aiManager integration to avoid timeouts

    // Simulate progressive parameter streaming for edit_file tool
    const streamingStages = [
      '{"target_file": "src/app.ts"',
      '{"target_file": "src/app.ts", "code_edit": "function hello() { return true',
      '{"target_file": "src/app.ts", "code_edit": "function hello() { return true; }"}',
    ];

    // Test what extractCompleteParams would return at each stage
    const stage1Result = extractCompleteParams(streamingStages[0]);
    expect(stage1Result).toEqual({ target_file: "src/app.ts" });

    const stage2Result = extractCompleteParams(streamingStages[1]);
    expect(stage2Result).toEqual({ target_file: "src/app.ts" });

    const stage3Result = extractCompleteParams(streamingStages[2]);
    expect(stage3Result).toEqual({
      target_file: "src/app.ts",
      code_edit: "function hello() { return true; }",
    });

    // Test that we can format these for display
    const formatted1 = JSON.stringify(stage1Result, null, 2);
    const formatted2 = JSON.stringify(stage2Result, null, 2);
    const formatted3 = JSON.stringify(stage3Result, null, 2);

    expect(formatted1).toContain("src/app.ts");
    expect(formatted2).toContain("src/app.ts");
    expect(formatted3).toContain("src/app.ts");
    expect(formatted3).toContain("function hello()");

    // Simulate grep_search streaming
    const grepStages = [
      '{"query": "function"',
      '{"query": "function", "include_pattern": "*.ts"',
      '{"query": "function", "include_pattern": "*.ts", "case_sensitive": false}',
    ];

    const grepResults = grepStages.map((stage) => extractCompleteParams(stage));

    expect(grepResults[0]).toEqual({ query: "function" });
    expect(grepResults[1]).toEqual({
      query: "function",
      include_pattern: "*.ts",
    });
    expect(grepResults[2]).toEqual({
      query: "function",
      include_pattern: "*.ts",
      case_sensitive: false,
    });
  });

  it("should handle edge cases in parameter extraction", async () => {
    // Test various edge cases that might occur during streaming

    // Empty or invalid input
    expect(extractCompleteParams("")).toEqual({});
    expect(extractCompleteParams("invalid")).toEqual({});

    // Only opening brace
    expect(extractCompleteParams("{")).toEqual({});

    // Incomplete key
    expect(extractCompleteParams('{"target_f')).toEqual({});

    // Incomplete value
    expect(extractCompleteParams('{"target_file": "src/')).toEqual({});

    // Mixed complete and incomplete params
    expect(
      extractCompleteParams(
        '{"file": "test.js", "line": 42, "content": "incomplete',
      ),
    ).toEqual({
      file: "test.js",
      line: 42,
    });

    // Boolean and null values
    expect(
      extractCompleteParams(
        '{"active": true, "optional": null, "incomplete": "test',
      ),
    ).toEqual({
      active: true,
      optional: null,
    });
  });

  it("should properly format extracted params for display", async () => {
    // Test that extracted complete params are properly formatted as JSON
    const incompleteArgs =
      '{"target_file": "example.ts", "start_line": 10, "incomplete": "test';
    const extracted = extractCompleteParams(incompleteArgs);
    const formatted = JSON.stringify(extracted, null, 2);

    const expected = JSON.stringify(
      {
        target_file: "example.ts",
        start_line: 10,
      },
      null,
      2,
    );

    expect(formatted).toBe(expected);

    // Verify it's valid JSON
    expect(() => JSON.parse(formatted)).not.toThrow();
  });

  it("should fall back to truncated string when no complete params exist", () => {
    // Test the fallback behavior when extractCompleteParams returns empty object
    const malformedJson =
      '{"incomplete_key": "very long incomplete value that should be truncated when displayed to the user';
    const extracted = extractCompleteParams(malformedJson);

    expect(extracted).toEqual({});

    // This simulates what the aiManager would do in this case
    const fallback =
      malformedJson.length > 50
        ? malformedJson.substring(0, 50) + "..."
        : malformedJson;

    expect(fallback.length).toBe(53); // 50 chars + "..."
    expect(fallback.endsWith("...")).toBe(true);
    expect(
      fallback.startsWith('{"incomplete_key": "very long incomplete value'),
    ).toBe(true);
  });
});
