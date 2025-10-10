import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { AIManager } from "@/managers/aiManager.js";
import * as aiService from "@/services/aiService.js";

// Mock the session service
vi.mock("@/services/session", () => ({
  saveSession: vi.fn(),
  loadSession: vi.fn(() => Promise.resolve(null)),
  getLatestSession: vi.fn(() => Promise.resolve(null)),
  cleanupExpiredSessions: vi.fn(() => Promise.resolve()),
}));

// Mock the aiService module
vi.mock("@/services/aiService");

// Mock the toolRegistry
let mockToolExecute: ReturnType<typeof vi.fn>;
vi.mock("@/tools", () => ({
  ToolRegistryImpl: vi.fn().mockImplementation(() => ({
    execute: (mockToolExecute = vi.fn()),
    list: vi.fn(() => []),
    getToolsConfig: vi.fn(() => []),
  })),
}));

// Mock logger
vi.mock("@/utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock memory utilities
vi.mock("@/utils/memoryUtils", () => ({
  readMemoryFile: vi.fn().mockResolvedValue(""),
}));

// Mock memory manager
vi.mock("@/services/memoryManager", () => ({
  createMemoryManager: vi.fn(() => ({
    getUserMemoryContent: vi.fn().mockResolvedValue(""),
  })),
}));

describe("AIManager - No Parameters Tool Handling", () => {
  let aiManager: AIManager;
  const mockCallbacks = {
    onMessagesChange: vi.fn(),
    onLoadingChange: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    aiManager = await AIManager.create({
      callbacks: mockCallbacks,
    });
  });

  afterEach(async () => {
    await aiManager.destroy();
  });

  it("should handle tools with no parameters (empty string)", async () => {
    const mockCallAgent = vi.mocked(aiService.callAgent);

    // Mock tool execution success
    mockToolExecute.mockResolvedValue({
      success: true,
      content: "Tool executed successfully",
    });

    let callCount = 0;

    // Mock callAgent to return a tool call with empty arguments
    mockCallAgent.mockImplementation(async () => {
      callCount++;

      if (callCount === 1) {
        // First call: return tool call with empty arguments
        return {
          content: "",
          tool_calls: [
            {
              id: "tool_123",
              type: "function" as const,
              function: {
                name: "list_pages",
                arguments: "", // No parameters - empty string
              },
            },
          ],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 20,
            total_tokens: 30,
          },
        };
      } else {
        // Subsequent calls: return no tool calls to stop recursion
        return {
          content: "Tool executed successfully",
          tool_calls: [], // No more tool calls
          usage: {
            prompt_tokens: 5,
            completion_tokens: 10,
            total_tokens: 15,
          },
        };
      }
    });

    // Execute the test
    await aiManager.sendMessage("Test message");

    // Verify tool was executed with empty parameters
    expect(mockToolExecute).toHaveBeenCalledWith(
      "list_pages",
      {}, // Empty object for no parameters
      expect.any(Object),
    );

    // Verify no error blocks were added
    const messages = aiManager.messages;
    const errorBlocks = messages.flatMap((msg) =>
      msg.blocks.filter((block) => block.type === "error"),
    );
    expect(errorBlocks).toHaveLength(0);

    // Verify tool execution was successful
    const toolBlocks = messages.flatMap((msg) =>
      msg.blocks.filter((block) => block.type === "tool"),
    );
    expect(toolBlocks).toHaveLength(1);
  });

  it("should handle tools with no parameters (empty object)", async () => {
    const mockCallAgent = vi.mocked(aiService.callAgent);

    // Mock tool execution success
    mockToolExecute.mockResolvedValue({
      success: true,
      content: "Tool executed successfully",
    });

    let callCount = 0;

    // Mock callAgent to return a tool call with empty object arguments
    mockCallAgent.mockImplementation(async () => {
      callCount++;

      if (callCount === 1) {
        // First call: return tool call with empty object arguments
        return {
          content: "",
          tool_calls: [
            {
              id: "tool_456",
              type: "function" as const,
              function: {
                name: "list_pages",
                arguments: "{}", // No parameters - empty object
              },
            },
          ],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 20,
            total_tokens: 30,
          },
        };
      } else {
        // Subsequent calls: return no tool calls to stop recursion
        return {
          content: "Tool executed successfully",
          tool_calls: [], // No more tool calls
          usage: {
            prompt_tokens: 5,
            completion_tokens: 10,
            total_tokens: 15,
          },
        };
      }
    });

    // Execute the test
    await aiManager.sendMessage("Test message");

    // Verify tool was executed with empty parameters
    expect(mockToolExecute).toHaveBeenCalledWith(
      "list_pages",
      {}, // Empty object for no parameters
      expect.any(Object),
    );

    // Verify no error blocks were added
    const messages = aiManager.messages;
    const errorBlocks = messages.flatMap((msg) =>
      msg.blocks.filter((block) => block.type === "error"),
    );
    expect(errorBlocks).toHaveLength(0);

    // Verify tool execution was successful
    const toolBlocks = messages.flatMap((msg) =>
      msg.blocks.filter((block) => block.type === "tool"),
    );
    expect(toolBlocks).toHaveLength(1);
  });

  it("should still throw error for malformed JSON parameters", async () => {
    const mockCallAgent = vi.mocked(aiService.callAgent);

    // Mock tool execution (should not be called)
    mockToolExecute.mockResolvedValue({
      success: false,
      content: "Should not execute",
      error: "Should not reach here",
    });

    let callCount = 0;

    // Mock callAgent to return malformed JSON tool call
    mockCallAgent.mockImplementation(async () => {
      callCount++;

      if (callCount === 1) {
        // First call: return malformed JSON tool call
        return {
          content: "",
          tool_calls: [
            {
              id: "tool_789",
              type: "function" as const,
              function: {
                name: "search_replace",
                arguments: '{"file_path": "test.ts", malformed', // Malformed JSON
              },
            },
          ],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 20,
            total_tokens: 30,
          },
        };
      } else {
        // Subsequent calls: return no tool calls to stop recursion
        return {
          content: "I see there was a JSON parsing error.",
          tool_calls: [], // No more tool calls
          usage: {
            prompt_tokens: 5,
            completion_tokens: 10,
            total_tokens: 15,
          },
        };
      }
    });

    // Execute the test
    await aiManager.sendMessage("Test message");

    // Check that error message is added to the conversation
    const messages = aiManager.messages;
    const errorBlocks = messages.flatMap((msg) =>
      msg.blocks.filter((block) => block.type === "error"),
    );
    const hasParseError = errorBlocks.some((block) =>
      block.content?.includes("Failed to parse tool arguments"),
    );
    expect(hasParseError).toBe(true);

    // Verify tool execute was not called due to JSON parse error
    expect(mockToolExecute).not.toHaveBeenCalled();
  });
});
