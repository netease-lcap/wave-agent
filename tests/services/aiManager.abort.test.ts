import { describe, it, expect, vi, beforeEach } from "vitest";
import { AIManager } from "@/services/aiManager";
import * as aiService from "@/services/aiService";
import { FileManager } from "@/services/fileManager";
import { SessionManager } from "@/services/sessionManager";
import type { Message, ErrorBlock } from "@/types";
import { FunctionToolCall } from "openai/resources/beta/threads/runs.js";

// Mock AI Service
vi.mock("@/services/aiService");

// Mock File Manager
vi.mock("@/services/fileManager");

// Mock Session Manager
vi.mock("@/services/sessionManager");

// Mock memory utils to prevent file reading
vi.mock("@/utils/memoryUtils", () => ({
  readMemoryFile: vi.fn(() => Promise.resolve("")),
  writeMemoryFile: vi.fn(() => Promise.resolve()),
}));

// Mock tool registry to control tool execution
vi.mock("@/tools", () => ({
  toolRegistry: {
    execute: vi.fn(),
  },
}));

describe("AIManager - Abort Handling", () => {
  let aiManager: AIManager;
  let mockFileManager: FileManager;

  beforeEach(() => {
    // Create a mock FileManager instance
    mockFileManager = {
      getFiles: vi.fn(() => []),
      getFileContent: vi.fn(() => ""),
      updateFile: vi.fn(),
      deleteFile: vi.fn(),
      addFile: vi.fn(),
      initialize: vi.fn(),
      startWatching: vi.fn(),
      stopWatching: vi.fn(),
      syncFilesFromDisk: vi.fn(),
      getFlatFiles: vi.fn(() => []),
    } as unknown as FileManager;

    // Mock SessionManager
    const mockSessionManager = vi.mocked(SessionManager);
    mockSessionManager.saveSession = vi.fn();

    // Create mock callbacks
    const mockCallbacks = {
      onMessagesChange: vi.fn(),
      onLoadingChange: vi.fn(),
      onFlatFilesChange: vi.fn(),
      getCurrentInputHistory: vi.fn(() => []),
    };

    // Create AIManager instance with required parameters
    aiManager = new AIManager("/test/workdir", mockCallbacks, mockFileManager);

    vi.clearAllMocks();
  });

  it("should handle JSON parse error gracefully when aborted during tool argument streaming", async () => {
    const mockCallAgent = vi.mocked(aiService.callAgent);

    // Setup initial messages
    const initialUserMessage: Message = {
      role: "user",
      blocks: [
        {
          type: "text",
          content: "Test message",
        },
      ],
    };

    aiManager.setMessages([initialUserMessage]);

    mockCallAgent.mockImplementation(
      async ({ abortSignal, onToolCallUpdate }) => {
        // Simulate streaming incomplete tool call arguments
        if (onToolCallUpdate) {
          // Simulate incomplete JSON being streamed
          onToolCallUpdate(
            {
              id: "tool_123",
              function: {
                name: "search_replace",
                arguments: '{"file_path": "test.ts", "old_string": "incomplete', // incomplete JSON
              },
            } as FunctionToolCall,
            false, // not complete
          );

          // Simulate user pressing ESC - abort the operation
          if (abortSignal) {
            // Create a new AbortController to simulate the abort
            const controller = new AbortController();
            controller.abort();
            // Mock the aborted signal
            Object.defineProperty(abortSignal, "aborted", {
              value: true,
              writable: true,
            });
          }
        }

        // Return tool call with incomplete arguments
        return {
          content: "",
          tool_calls: [
            {
              id: "tool_123",
              type: "function" as const,
              function: {
                name: "search_replace",
                arguments: '{"file_path": "test.ts", "old_string": "incomplete', // incomplete JSON that will cause parse error
              },
            },
          ],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 20,
            total_tokens: 30,
          },
        };
      },
    );

    // Execute the test - should not throw error even with incomplete JSON and abort
    await expect(aiManager.sendAIMessage()).resolves.not.toThrow();

    // Verify that the manager doesn't crash and handles the situation gracefully
    expect(mockCallAgent).toHaveBeenCalledTimes(1);

    // Check that no error message is added to the conversation when aborted
    const messages = aiManager.getState().messages;
    const errorBlocks = messages.flatMap((msg) =>
      msg.blocks.filter((block) => block.type === "error"),
    );
    const hasParseError = errorBlocks.some((block) =>
      (block as ErrorBlock).content?.includes("Failed to parse tool arguments"),
    );
    expect(hasParseError).toBe(false);
  });

  it("should show JSON parse error when not aborted but has malformed JSON", async () => {
    const mockCallAgent = vi.mocked(aiService.callAgent);
    const { toolRegistry } = await import("@/tools");
    const mockToolExecute = vi.mocked(toolRegistry.execute);

    // Mock tool execute - should not be called due to JSON parse error
    mockToolExecute.mockResolvedValue({
      success: false,
      content: "Should not execute",
      error: "Should not reach here",
    });

    // Setup initial messages
    const initialUserMessage: Message = {
      role: "user",
      blocks: [
        {
          type: "text",
          content: "Test message",
        },
      ],
    };

    aiManager.setMessages([initialUserMessage]);

    // Use a call counter to prevent infinite recursion
    let callCount = 0;

    // Mock callAgent to return malformed JSON tool call on first call, then no tools
    mockCallAgent.mockImplementation(async ({ onToolCallUpdate }) => {
      callCount++;

      if (callCount === 1) {
        // First call: return malformed JSON tool call
        if (onToolCallUpdate) {
          onToolCallUpdate(
            {
              id: "tool_123",
              function: {
                name: "search_replace",
                arguments:
                  '{"file_path": "test.ts", "old_string": "malformed"}', // complete but will be malformed in return
              },
            } as FunctionToolCall,
            true, // complete
          );
        }

        return {
          content: "",
          tool_calls: [
            {
              id: "tool_123",
              type: "function" as const,
              function: {
                name: "search_replace",
                arguments: '{"file_path": "test.ts", "old_string": malformed}', // malformed JSON - missing quotes
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
          content:
            "I see there was a JSON parsing error. Let me provide a proper response.",
          tool_calls: [], // No more tool calls to prevent infinite recursion
          usage: {
            prompt_tokens: 5,
            completion_tokens: 10,
            total_tokens: 15,
          },
        };
      }
    });

    // Execute the test
    await aiManager.sendAIMessage();

    // Check that error message is added to the conversation when not aborted
    const messages = aiManager.getState().messages;
    const errorBlocks = messages.flatMap((msg) =>
      msg.blocks.filter((block) => block.type === "error"),
    );
    const hasParseError = errorBlocks.some((block) =>
      (block as ErrorBlock).content?.includes(
        "Failed to parse tool arguments for search_replace",
      ),
    );
    expect(hasParseError).toBe(true);

    // Verify tool execute was not called due to JSON parse error
    expect(mockToolExecute).not.toHaveBeenCalled();

    // Verify callAgent was called at least twice (initial + recursive after error)
    expect(mockCallAgent).toHaveBeenCalledTimes(2);
  });

  it("should abort gracefully without executing tools when interrupted during streaming", async () => {
    const mockCallAgent = vi.mocked(aiService.callAgent);
    const { toolRegistry } = await import("@/tools");
    const mockToolExecute = vi.mocked(toolRegistry.execute);

    // Setup initial messages
    const initialUserMessage: Message = {
      role: "user",
      blocks: [
        {
          type: "text",
          content: "Test message",
        },
      ],
    };

    aiManager.setMessages([initialUserMessage]);

    mockCallAgent.mockImplementation(
      async ({ abortSignal, onToolCallUpdate }) => {
        // Simulate streaming tool call
        if (onToolCallUpdate) {
          onToolCallUpdate(
            {
              id: "tool_123",
              function: {
                name: "search_replace",
                arguments: '{"file_path": "test.ts"',
              },
            } as FunctionToolCall,
            false,
          );

          // Simulate abort during streaming
          if (abortSignal) {
            // Create a new AbortController to simulate the abort
            const controller = new AbortController();
            controller.abort();
            // Mock the aborted signal
            Object.defineProperty(abortSignal, "aborted", {
              value: true,
              writable: true,
            });
          }
        }

        // Even though we return tool calls, they shouldn't be executed due to abort
        return {
          content: "",
          tool_calls: [
            {
              id: "tool_123",
              type: "function" as const,
              function: {
                name: "search_replace",
                arguments: '{"file_path": "test.ts"}', // valid JSON
              },
            },
          ],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 20,
            total_tokens: 30,
          },
        };
      },
    );

    // Mock tool execute to ensure it's not called
    mockToolExecute.mockResolvedValue({
      success: true,
      content: "Tool should not execute",
    });

    await aiManager.sendAIMessage();

    // Verify no tools were actually executed due to abort
    expect(mockToolExecute).not.toHaveBeenCalled();
  });
});
