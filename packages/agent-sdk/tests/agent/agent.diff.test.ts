import { describe, it, expect, vi, beforeEach } from "vitest";
import { Agent } from "@/agent.js";
import * as aiService from "@/services/aiService.js";
import { ToolContext } from "@/tools/types.js";

// Mock AI Service
vi.mock("@/services/aiService");

// Mock tool registry to control tool execution
let mockToolExecute: ReturnType<typeof vi.fn>;
vi.mock("@/managers/toolManager", () => ({
  ToolManager: vi.fn().mockImplementation(() => ({
    execute: (mockToolExecute = vi.fn()),
    list: vi.fn(() => []),
    getToolsConfig: vi.fn(() => []),
  })),
}));

describe("Agent Diff Integration Tests", () => {
  let agent: Agent;
  let aiServiceCallCount: number;

  beforeEach(async () => {
    // Create mock callbacks
    const mockCallbacks = {
      onMessagesChange: vi.fn(),
      onLoadingChange: vi.fn(),
    };

    // Create Agent instance with required parameters
    agent = await Agent.create({
      callbacks: mockCallbacks,
    });

    // Reset counters
    aiServiceCallCount = 0;

    vi.clearAllMocks();
  });

  it("should show diff after edit_file tool execution", async () => {
    const mockCallAgent = vi.mocked(aiService.callAgent);

    mockCallAgent.mockImplementation(async () => {
      aiServiceCallCount++;

      if (aiServiceCallCount === 1) {
        // First AI call: return edit_file tool call
        return {
          tool_calls: [
            {
              id: "call_edit_123",
              type: "function" as const,
              index: 0,
              function: {
                name: "edit_file",
                arguments: JSON.stringify({
                  target_file: "test.js",
                  instructions: "Add error handling",
                  code_edit: `function greet(name) {
  if (!name) {
    throw new Error('Name is required');
  }
  console.log('Hello, ' + name);
}`,
                }),
              },
            },
          ],
        };
      } else if (aiServiceCallCount === 2) {
        // Second AI call: response based on tool results
        return {
          content: "Error handling logic has been added.",
        };
      }

      return {};
    });

    // Mock edit_file tool execution, simulate addDiffBlock callback
    mockToolExecute.mockImplementation(
      async (
        toolName: string,
        args: Record<string, unknown>,
        context: ToolContext,
      ) => {
        // Simulate the tool calling context.addDiffBlock
        if (context.addDiffBlock) {
          context.addDiffBlock("test.js", [
            { value: "function greet(name) {\n" },
            {
              value:
                "  if (!name) {\n    throw new Error('Name is required');\n  }\n",
              added: true,
            },
            { value: "  console.log('Hello, ' + name);\n}" },
          ]);
        }

        return {
          success: true,
          content: "Rewrote file test.js with error handling",
          shortResult: "Modified test.js",
          filePath: "test.js",
          originalContent: `function greet(name) {
  console.log('Hello, ' + name);
}`,
          newContent: `function greet(name) {
  if (!name) {
    throw new Error('Name is required');
  }
  console.log('Hello, ' + name);
}`,
        };
      },
    );

    // Call sendMessage to trigger tool execution and recursion
    await agent.sendMessage("Test message");

    // Verify AI service was called twice
    expect(mockCallAgent).toHaveBeenCalledTimes(2);
    expect(aiServiceCallCount).toBe(2);

    // Verify tool was executed once
    expect(mockToolExecute).toHaveBeenCalledTimes(1);
    expect(mockToolExecute).toHaveBeenCalledWith(
      "edit_file",
      {
        target_file: "test.js",
        instructions: "Add error handling",
        code_edit: expect.stringContaining("throw new Error"),
      },
      expect.objectContaining({
        abortSignal: expect.any(AbortSignal),
      }),
    );

    // Verify the second AI call included the tool execution result
    const secondCall = mockCallAgent.mock.calls[1][0];
    const toolMessage = secondCall.messages.find((msg) => msg.role === "tool");
    expect(toolMessage).toBeDefined();
    expect(toolMessage?.tool_call_id).toBe("call_edit_123");
    expect(toolMessage?.content).toContain("Rewrote file test.js");

    // Verify messages in current Agent state were obtained
    const messages = agent.messages;

    // Should include user message, assistant message (with tool call), tool result message, and final assistant reply
    expect(messages.length).toBeGreaterThanOrEqual(3);

    // Check for diff block of file operations
    const hasDiffBlock = messages.some((message) =>
      message.blocks?.some(
        (block) =>
          block.type === "diff" &&
          "diffResult" in block &&
          Array.isArray(block.diffResult) &&
          block.diffResult.some(
            (part) =>
              part.value.includes("throw new Error") && part.added === true,
          ),
      ),
    );
    expect(hasDiffBlock).toBe(true);
  });

  it("should show diff after search_replace tool execution", async () => {
    // Reset counter
    aiServiceCallCount = 0;

    const mockCallAgent = vi.mocked(aiService.callAgent);

    mockCallAgent.mockImplementation(async () => {
      aiServiceCallCount++;

      if (aiServiceCallCount === 1) {
        // First AI call: return search_replace tool call
        return {
          tool_calls: [
            {
              id: "call_replace_456",
              type: "function" as const,
              index: 0,
              function: {
                name: "search_replace",
                arguments: JSON.stringify({
                  file_path: "test.js",
                  old_string: "console.log('Hello, ' + name);",
                  new_string: "console.log(`Hello, ${name}!`);",
                }),
              },
            },
          ],
        };
      } else if (aiServiceCallCount === 2) {
        // Second AI call: response based on tool results
        return {
          content:
            "String concatenation has been changed to template literals.",
        };
      }

      return {};
    });

    // Mock search_replace tool execution, simulate addDiffBlock callback
    mockToolExecute.mockImplementation(
      async (
        toolName: string,
        args: Record<string, unknown>,
        context: ToolContext,
      ) => {
        // Simulate the tool calling context.addDiffBlock
        if (context.addDiffBlock) {
          context.addDiffBlock("test.js", [
            { value: "function greet(name) {\n" },
            { value: "  console.log('Hello, ' + name);\n", removed: true },
            { value: "  console.log(`Hello, ${name}!`);\n", added: true },
            { value: "}" },
          ]);
        }

        return {
          success: true,
          content: "Successfully replaced text in test.js",
          shortResult: "Updated test.js",
          filePath: "test.js",
          originalContent: `function greet(name) {
  console.log('Hello, ' + name);
}`,
          newContent: `function greet(name) {
  console.log(\`Hello, \${name}!\`);
}`,
        };
      },
    );

    // Call sendMessage to trigger tool execution and recursion
    await agent.sendMessage("Test message");

    // Verify call count
    expect(mockCallAgent).toHaveBeenCalledTimes(2);
    expect(aiServiceCallCount).toBe(2);

    // Verify tool execution
    expect(mockToolExecute).toHaveBeenCalledTimes(1);
    expect(mockToolExecute).toHaveBeenCalledWith(
      "search_replace",
      {
        file_path: "test.js",
        old_string: "console.log('Hello, ' + name);",
        new_string: "console.log(`Hello, ${name}!`);",
      },
      expect.objectContaining({
        abortSignal: expect.any(AbortSignal),
      }),
    );

    // Verify tool execution result
    const secondCall = mockCallAgent.mock.calls[1][0];
    const toolMessage = secondCall.messages.find((msg) => msg.role === "tool");
    expect(toolMessage).toBeDefined();
    expect(toolMessage?.tool_call_id).toBe("call_replace_456");
    expect(toolMessage?.content).toContain("Successfully replaced text");

    // Verify current state contains diff information
    const messages = agent.messages;

    // Check for diff block of file operations
    const hasDiffBlock = messages.some((message) =>
      message.blocks?.some(
        (block) =>
          block.type === "diff" &&
          "diffResult" in block &&
          Array.isArray(block.diffResult) &&
          block.diffResult.some(
            (part) =>
              part.value.includes("Hello, ${name}!") && part.added === true,
          ),
      ),
    );
    expect(hasDiffBlock).toBe(true);
  });

  it("should handle multiple file operations with diffs", async () => {
    aiServiceCallCount = 0;

    const mockCallAgent = vi.mocked(aiService.callAgent);

    mockCallAgent.mockImplementation(async () => {
      aiServiceCallCount++;

      if (aiServiceCallCount === 1) {
        // First AI call: return multiple tool calls
        return {
          tool_calls: [
            {
              id: "call_edit_1",
              type: "function" as const,
              index: 0,
              function: {
                name: "edit_file",
                arguments: JSON.stringify({
                  target_file: "file1.js",
                  instructions: "Add logging",
                  code_edit: "console.log('Starting application');",
                }),
              },
            },
            {
              id: "call_edit_2",
              type: "function" as const,
              index: 1,
              function: {
                name: "edit_file",
                arguments: JSON.stringify({
                  target_file: "file2.js",
                  instructions: "Add error handling",
                  code_edit: "try { main(); } catch(e) { console.error(e); }",
                }),
              },
            },
          ],
        };
      } else if (aiServiceCallCount === 2) {
        // Second AI call: response based on tool results
        return {
          content: "Modified two files, added logging and error handling.",
        };
      }

      return {};
    });

    // Mock tool execution - return different results based on file name and simulate addDiffBlock
    mockToolExecute.mockImplementation(
      async (
        toolName: string,
        args: Record<string, unknown>,
        context: ToolContext,
      ) => {
        if (args.target_file === "file1.js") {
          // Simulate the tool calling context.addDiffBlock
          if (context.addDiffBlock) {
            context.addDiffBlock("file1.js", [
              { value: "console.log('Starting application');", added: true },
            ]);
          }

          return {
            success: true,
            content: "Created file1.js with logging",
            shortResult: "Created file1.js",
            filePath: "file1.js",
            originalContent: "",
            newContent: "console.log('Starting application');",
          };
        } else if (args.target_file === "file2.js") {
          // Simulate the tool calling context.addDiffBlock
          if (context.addDiffBlock) {
            context.addDiffBlock("file2.js", [
              {
                value: "try { main(); } catch(e) { console.error(e); }",
                added: true,
              },
            ]);
          }

          return {
            success: true,
            content: "Created file2.js with error handling",
            shortResult: "Created file2.js",
            filePath: "file2.js",
            originalContent: "",
            newContent: "try { main(); } catch(e) { console.error(e); }",
          };
        }

        return {
          success: false,
          content: "Unknown file",
          error: "File not recognized",
        };
      },
    );

    // Call sendMessage to trigger tool execution and recursion
    await agent.sendMessage("Test message");

    // Verify AI service was called twice
    expect(mockCallAgent).toHaveBeenCalledTimes(2);

    // Verify tools were executed twice
    expect(mockToolExecute).toHaveBeenCalledTimes(2);

    // Verify first tool call
    expect(mockToolExecute).toHaveBeenNthCalledWith(
      1,
      "edit_file",
      expect.objectContaining({ target_file: "file1.js" }),
      expect.any(Object),
    );

    // Verify second tool call
    expect(mockToolExecute).toHaveBeenNthCalledWith(
      2,
      "edit_file",
      expect.objectContaining({ target_file: "file2.js" }),
      expect.any(Object),
    );

    // Verify second AI call contains all tool execution results
    const secondCall = mockCallAgent.mock.calls[1][0];
    const toolMessages = secondCall.messages.filter(
      (msg) => msg.role === "tool",
    );
    expect(toolMessages).toHaveLength(2);

    // Verify tool message content
    const file1ToolMessage = toolMessages.find(
      (msg) => msg.tool_call_id === "call_edit_1",
    );
    expect(file1ToolMessage?.content).toContain("Created file1.js");

    const file2ToolMessage = toolMessages.find(
      (msg) => msg.tool_call_id === "call_edit_2",
    );
    expect(file2ToolMessage?.content).toContain("Created file2.js");

    // Verify current state contains diff information for two files
    const messages = agent.messages;

    // Check if there are diff blocks for two file operations
    const diffBlocks = messages.flatMap(
      (message) =>
        message.blocks?.filter((block) => block.type === "diff") || [],
    );
    expect(diffBlocks).toHaveLength(2);

    // Verify diff content for each file
    const file1Block = diffBlocks.find(
      (block) => "path" in block && block.path === "file1.js",
    );
    expect(file1Block).toBeDefined();
    if (
      file1Block &&
      "diffResult" in file1Block &&
      Array.isArray(file1Block.diffResult)
    ) {
      expect(
        file1Block.diffResult.some(
          (part) =>
            part.value.includes("Starting application") && part.added === true,
        ),
      ).toBe(true);
    }

    const file2Block = diffBlocks.find(
      (block) => "path" in block && block.path === "file2.js",
    );
    expect(file2Block).toBeDefined();
    if (
      file2Block &&
      "diffResult" in file2Block &&
      Array.isArray(file2Block.diffResult)
    ) {
      expect(
        file2Block.diffResult.some(
          (part) =>
            part.value.includes("console.error(e)") && part.added === true,
        ),
      ).toBe(true);
    }
  });

  it("should handle tool execution failure without diff", async () => {
    const mockCallAgent = vi.mocked(aiService.callAgent);

    mockCallAgent.mockImplementation(async () => {
      aiServiceCallCount++;

      if (aiServiceCallCount === 1) {
        // First AI call: return tool call
        return {
          tool_calls: [
            {
              id: "call_fail_789",
              type: "function" as const,
              index: 0,
              function: {
                name: "edit_file",
                arguments: JSON.stringify({
                  target_file: "nonexistent.js",
                  instructions: "Try to edit",
                  code_edit: "console.log('test');",
                }),
              },
            },
          ],
        };
      } else if (aiServiceCallCount === 2) {
        // Second AI call: response based on error result
        return {
          content: "Sorry, the file does not exist and cannot be modified.",
        };
      }

      return {};
    });

    // Mock tool execution failure - no diff related information
    mockToolExecute.mockResolvedValue({
      success: false,
      content: "Error: File nonexistent.js not found",
      error: "File not found",
      shortResult: "File operation failed",
    });

    // Call sendMessage to trigger tool execution and recursion
    await agent.sendMessage("Test message");

    // Verify AI service was called twice (even tool failure triggers recursion)
    expect(mockCallAgent).toHaveBeenCalledTimes(2);

    // Verify tool was executed once
    expect(mockToolExecute).toHaveBeenCalledTimes(1);

    // Verify second AI call contains error information
    const secondCall = mockCallAgent.mock.calls[1][0];
    const toolMessage = secondCall.messages.find((msg) => msg.role === "tool");
    expect(toolMessage).toBeDefined();
    expect(toolMessage?.tool_call_id).toBe("call_fail_789");
    expect(toolMessage?.content).toContain(
      "Error: File nonexistent.js not found",
    );

    // Verify current state has no diff related blocks (because tool execution failed)
    const messages = agent.messages;

    const diffBlocks = messages.flatMap(
      (message) =>
        message.blocks?.filter((block) => block.type === "diff") || [],
    );
    expect(diffBlocks).toHaveLength(0);
  });
});
