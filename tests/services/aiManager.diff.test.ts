import { describe, it, expect, vi, beforeEach } from "vitest";
import { AIManager } from "@/services/aiManager";
import * as aiService from "@/services/aiService";
import { FileManager } from "@/services/fileManager";
import { SessionManager } from "@/services/sessionManager";
import type { Message } from "@/types";

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

describe("AIManager Diff Integration Tests", () => {
  let aiManager: AIManager;
  let mockFileManager: FileManager;
  let aiServiceCallCount: number;

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

    // Reset counters
    aiServiceCallCount = 0;

    vi.clearAllMocks();
  });

  it("should show diff after edit_file tool execution", async () => {
    // 添加初始用户消息
    const initialUserMessage: Message = {
      role: "user",
      blocks: [
        {
          type: "text",
          content: "请添加错误处理",
        },
      ],
    };

    aiManager.setMessages([initialUserMessage]);

    const mockCallAgent = vi.mocked(aiService.callAgent);
    const { toolRegistry } = await import("@/tools");
    const mockToolExecute = vi.mocked(toolRegistry.execute);

    mockCallAgent.mockImplementation(async () => {
      aiServiceCallCount++;

      if (aiServiceCallCount === 1) {
        // 第一次 AI 调用：返回 edit_file 工具调用
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
        // 第二次 AI 调用：基于工具结果的响应
        return {
          content: "已添加错误处理逻辑。",
        };
      }

      return {};
    });

    // Mock edit_file 工具执行，返回 diff 相关信息
    mockToolExecute.mockResolvedValue({
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
      diffResult: [
        { value: "function greet(name) {\n" },
        {
          value:
            "  if (!name) {\n    throw new Error('Name is required');\n  }\n",
          added: true,
        },
        { value: "  console.log('Hello, ' + name);\n}" },
      ],
    });

    // 调用 sendAIMessage 触发工具执行和递归
    await aiManager.sendAIMessage();

    // 验证 AI service 被调用了两次
    expect(mockCallAgent).toHaveBeenCalledTimes(2);
    expect(aiServiceCallCount).toBe(2);

    // 验证工具被执行了一次
    expect(mockToolExecute).toHaveBeenCalledTimes(1);
    expect(mockToolExecute).toHaveBeenCalledWith(
      "edit_file",
      {
        target_file: "test.js",
        instructions: "Add error handling",
        code_edit: expect.stringContaining("throw new Error"),
      },
      expect.objectContaining({
        workdir: "/test/workdir",
        abortSignal: expect.any(AbortSignal),
      }),
    );

    // 验证第二次 AI 调用包含了工具执行结果
    const secondCall = mockCallAgent.mock.calls[1][0];
    const toolMessage = secondCall.messages.find((msg) => msg.role === "tool");
    expect(toolMessage).toBeDefined();
    expect(toolMessage?.tool_call_id).toBe("call_edit_123");
    expect(toolMessage?.content).toContain("Rewrote file test.js");

    // 验证获取到了当前 AIManager 状态中的消息
    const currentState = aiManager.getState();
    const messages = currentState.messages;

    // 应该包含用户消息、助手消息（带工具调用）、工具结果消息、以及最终的助手回复
    expect(messages.length).toBeGreaterThanOrEqual(3);

    // 检查是否有文件操作的 diff 块
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
    // 添加初始用户消息
    const initialUserMessage: Message = {
      role: "user",
      blocks: [
        {
          type: "text",
          content: "请使用模板字符串",
        },
      ],
    };

    aiManager.setMessages([initialUserMessage]);

    // 重置计数器
    aiServiceCallCount = 0;

    const mockCallAgent = vi.mocked(aiService.callAgent);
    const { toolRegistry } = await import("@/tools");
    const mockToolExecute = vi.mocked(toolRegistry.execute);

    mockCallAgent.mockImplementation(async () => {
      aiServiceCallCount++;

      if (aiServiceCallCount === 1) {
        // 第一次 AI 调用：返回 search_replace 工具调用
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
        // 第二次 AI 调用：基于工具结果的响应
        return {
          content: "已将字符串拼接改为模板字符串。",
        };
      }

      return {};
    });

    // Mock search_replace 工具执行，返回 diff 相关信息
    mockToolExecute.mockResolvedValue({
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
      diffResult: [
        { value: "function greet(name) {\n" },
        { value: "  console.log('Hello, ' + name);\n", removed: true },
        { value: "  console.log(`Hello, ${name}!`);\n", added: true },
        { value: "}" },
      ],
    });

    // 调用 sendAIMessage 触发工具执行和递归
    await aiManager.sendAIMessage();

    // 验证调用次数
    expect(mockCallAgent).toHaveBeenCalledTimes(2);
    expect(aiServiceCallCount).toBe(2);

    // 验证工具执行
    expect(mockToolExecute).toHaveBeenCalledTimes(1);
    expect(mockToolExecute).toHaveBeenCalledWith(
      "search_replace",
      {
        file_path: "test.js",
        old_string: "console.log('Hello, ' + name);",
        new_string: "console.log(`Hello, ${name}!`);",
      },
      expect.objectContaining({
        workdir: "/test/workdir",
        abortSignal: expect.any(AbortSignal),
      }),
    );

    // 验证工具执行结果
    const secondCall = mockCallAgent.mock.calls[1][0];
    const toolMessage = secondCall.messages.find((msg) => msg.role === "tool");
    expect(toolMessage).toBeDefined();
    expect(toolMessage?.tool_call_id).toBe("call_replace_456");
    expect(toolMessage?.content).toContain("Successfully replaced text");

    // 验证当前状态中包含 diff 信息
    const currentState = aiManager.getState();
    const messages = currentState.messages;

    // 检查是否有文件操作的 diff 块
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
    // 添加初始用户消息
    const initialUserMessage: Message = {
      role: "user",
      blocks: [
        {
          type: "text",
          content: "请修改多个文件",
        },
      ],
    };

    aiManager.setMessages([initialUserMessage]);

    aiServiceCallCount = 0;

    const mockCallAgent = vi.mocked(aiService.callAgent);
    const { toolRegistry } = await import("@/tools");
    const mockToolExecute = vi.mocked(toolRegistry.execute);

    mockCallAgent.mockImplementation(async () => {
      aiServiceCallCount++;

      if (aiServiceCallCount === 1) {
        // 第一次 AI 调用：返回多个工具调用
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
        // 第二次 AI 调用：基于工具结果的响应
        return {
          content: "已修改了两个文件，添加了日志记录和错误处理。",
        };
      }

      return {};
    });

    // Mock 工具执行 - 根据文件名返回不同结果
    mockToolExecute.mockImplementation(async (toolName, args) => {
      if (args.target_file === "file1.js") {
        return {
          success: true,
          content: "Created file1.js with logging",
          shortResult: "Created file1.js",
          filePath: "file1.js",
          originalContent: "",
          newContent: "console.log('Starting application');",
          diffResult: [
            { value: "console.log('Starting application');", added: true },
          ],
        };
      } else if (args.target_file === "file2.js") {
        return {
          success: true,
          content: "Created file2.js with error handling",
          shortResult: "Created file2.js",
          filePath: "file2.js",
          originalContent: "",
          newContent: "try { main(); } catch(e) { console.error(e); }",
          diffResult: [
            {
              value: "try { main(); } catch(e) { console.error(e); }",
              added: true,
            },
          ],
        };
      }

      return {
        success: false,
        content: "Unknown file",
        error: "File not recognized",
      };
    });

    // 调用 sendAIMessage 触发工具执行和递归
    await aiManager.sendAIMessage();

    // 验证 AI service 被调用了两次
    expect(mockCallAgent).toHaveBeenCalledTimes(2);

    // 验证工具被执行了两次
    expect(mockToolExecute).toHaveBeenCalledTimes(2);

    // 验证第一个工具调用
    expect(mockToolExecute).toHaveBeenNthCalledWith(
      1,
      "edit_file",
      expect.objectContaining({ target_file: "file1.js" }),
      expect.any(Object),
    );

    // 验证第二个工具调用
    expect(mockToolExecute).toHaveBeenNthCalledWith(
      2,
      "edit_file",
      expect.objectContaining({ target_file: "file2.js" }),
      expect.any(Object),
    );

    // 验证第二次 AI 调用包含了所有工具执行结果
    const secondCall = mockCallAgent.mock.calls[1][0];
    const toolMessages = secondCall.messages.filter(
      (msg) => msg.role === "tool",
    );
    expect(toolMessages).toHaveLength(2);

    // 验证工具消息的内容
    const file1ToolMessage = toolMessages.find(
      (msg) => msg.tool_call_id === "call_edit_1",
    );
    expect(file1ToolMessage?.content).toContain("Created file1.js");

    const file2ToolMessage = toolMessages.find(
      (msg) => msg.tool_call_id === "call_edit_2",
    );
    expect(file2ToolMessage?.content).toContain("Created file2.js");

    // 验证当前状态中包含两个文件的 diff 信息
    const currentState = aiManager.getState();
    const messages = currentState.messages;

    // 检查是否有两个文件操作的 diff 块
    const diffBlocks = messages.flatMap(
      (message) =>
        message.blocks?.filter((block) => block.type === "diff") || [],
    );
    expect(diffBlocks).toHaveLength(2);

    // 验证每个文件的 diff 内容
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
    // 添加初始用户消息
    const initialUserMessage: Message = {
      role: "user",
      blocks: [
        {
          type: "text",
          content: "请修改不存在的文件",
        },
      ],
    };

    aiManager.setMessages([initialUserMessage]);

    aiServiceCallCount = 0;

    const mockCallAgent = vi.mocked(aiService.callAgent);
    const { toolRegistry } = await import("@/tools");
    const mockToolExecute = vi.mocked(toolRegistry.execute);

    mockCallAgent.mockImplementation(async () => {
      aiServiceCallCount++;

      if (aiServiceCallCount === 1) {
        // 第一次 AI 调用：返回工具调用
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
        // 第二次 AI 调用：基于错误结果的响应
        return {
          content: "抱歉，文件不存在，无法进行修改。",
        };
      }

      return {};
    });

    // Mock 工具执行失败 - 没有 diff 相关信息
    mockToolExecute.mockResolvedValue({
      success: false,
      content: "Error: File nonexistent.js not found",
      error: "File not found",
      shortResult: "File operation failed",
    });

    // 调用 sendAIMessage 触发工具执行和递归
    await aiManager.sendAIMessage();

    // 验证 AI service 被调用了两次（即使工具失败也会触发递归）
    expect(mockCallAgent).toHaveBeenCalledTimes(2);

    // 验证工具被执行了一次
    expect(mockToolExecute).toHaveBeenCalledTimes(1);

    // 验证第二次 AI 调用包含了错误信息
    const secondCall = mockCallAgent.mock.calls[1][0];
    const toolMessage = secondCall.messages.find((msg) => msg.role === "tool");
    expect(toolMessage).toBeDefined();
    expect(toolMessage?.tool_call_id).toBe("call_fail_789");
    expect(toolMessage?.content).toContain(
      "Error: File nonexistent.js not found",
    );

    // 验证当前状态中没有 diff 相关的块（因为工具执行失败）
    const currentState = aiManager.getState();
    const messages = currentState.messages;

    const diffBlocks = messages.flatMap(
      (message) =>
        message.blocks?.filter((block) => block.type === "diff") || [],
    );
    expect(diffBlocks).toHaveLength(0);
  });
});
