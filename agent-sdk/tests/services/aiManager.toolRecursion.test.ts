import { describe, it, expect, vi, beforeEach } from "vitest";
import { AIManager } from "@/services/aiManager.js";
import * as aiService from "@/services/aiService.js";
import { saveSession } from "@/services/session.js";

// Mock the session service
vi.mock("@/services/session", () => ({
  saveSession: vi.fn(),
  loadSession: vi.fn(() => Promise.resolve(null)),
  getLatestSession: vi.fn(() => Promise.resolve(null)),
  cleanupExpiredSessions: vi.fn(() => Promise.resolve()),
}));
import type { Message } from "@/types.js";

// Mock AI Service
vi.mock("@/services/aiService");

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

describe("AIManager Tool Recursion Tests", () => {
  let aiManager: AIManager;
  let aiServiceCallCount: number;

  beforeEach(async () => {
    // Mock session service
    const mockSaveSession = vi.mocked(saveSession);
    mockSaveSession.mockImplementation(vi.fn());

    // Create mock callbacks
    const mockCallbacks = {
      onMessagesChange: vi.fn(),
      onLoadingChange: vi.fn(),
    };

    // Create AIManager instance with required parameters
    aiManager = await AIManager.create({
      callbacks: mockCallbacks,
    });

    // Reset counters
    aiServiceCallCount = 0;

    vi.clearAllMocks();
  });

  it("should trigger recursive AI call after tool execution and verify message structure", async () => {
    // 添加初始用户消息
    const initialUserMessage: Message = {
      role: "user",
      blocks: [
        {
          type: "text",
          content: "请查看当前目录的内容",
        },
      ],
    };

    aiManager.setMessages([initialUserMessage]);

    // Mock AI service 返回工具调用，然后在第二次调用时返回简单响应
    const mockCallAgent = vi.mocked(aiService.callAgent);
    const { toolRegistry } = await import("@/tools/index.js");
    const mockToolExecute = vi.mocked(toolRegistry.execute);

    mockCallAgent.mockImplementation(async () => {
      aiServiceCallCount++;

      if (aiServiceCallCount === 1) {
        // 第一次 AI 调用：返回工具调用
        return {
          tool_calls: [
            {
              id: "call_123",
              type: "function" as const,
              index: 0,
              function: {
                name: "run_terminal_cmd",
                arguments: JSON.stringify({ command: "ls -la ." }),
              },
            },
          ],
        };
      } else if (aiServiceCallCount === 2) {
        // 第二次 AI 调用：返回基于工具结果的响应
        return {
          content:
            "好的，我已经成功执行了 `ls -la` 命令。从输出结果可以看到当前目录包含了 test.txt 文件以及其他内容。",
        };
      }

      return {};
    });

    // Mock 工具执行
    mockToolExecute.mockResolvedValue({
      success: true,
      content:
        "total 8\ndrwxr-xr-x 2 user user 4096 Jan 1 12:00 .\ndrwxr-xr-x 3 user user 4096 Jan 1 12:00 ..\n-rw-r--r-- 1 user user   12 Jan 1 12:00 test.txt",
      shortResult: "Listed directory contents",
    });

    // 调用 sendAIMessage 触发工具递归
    await aiManager.sendAIMessage();

    // 验证 AI service 被调用了两次（工具调用 + 递归调用）
    expect(mockCallAgent).toHaveBeenCalledTimes(2);
    expect(aiServiceCallCount).toBe(2);

    // 验证工具被执行了一次
    expect(mockToolExecute).toHaveBeenCalledTimes(1);
    expect(mockToolExecute).toHaveBeenCalledWith(
      "run_terminal_cmd",
      { command: "ls -la ." },
      expect.objectContaining({
        abortSignal: expect.any(AbortSignal),
      }),
    );

    // 验证第一次 AI 调用的参数（应该包含用户消息和新添加的助手消息）
    const firstCall = mockCallAgent.mock.calls[0][0];
    expect(firstCall.messages).toHaveLength(1); // 只有 user 消息
    expect(firstCall.messages[0].role).toBe("user");

    // 验证第二次 AI 调用的参数（应该包含工具执行结果）
    const secondCall = mockCallAgent.mock.calls[1][0];
    expect(secondCall.messages.length).toBeGreaterThan(2);

    // 应该包含原始用户消息
    const userMessage = secondCall.messages.find((msg) => msg.role === "user");
    expect(userMessage).toBeDefined();

    // 应该包含助手的工具调用消息
    const assistantMessage = secondCall.messages.find(
      (msg) => msg.role === "assistant",
    );
    expect(assistantMessage).toBeDefined();

    // 应该包含工具执行结果消息
    const toolMessage = secondCall.messages.find((msg) => msg.role === "tool");
    expect(toolMessage).toBeDefined();
    expect(toolMessage?.tool_call_id).toBe("call_123");
    expect(toolMessage?.content).toContain("total 8"); // 验证工具执行有输出
  });

  it("should handle multiple tool calls in sequence", async () => {
    // 添加初始用户消息
    const initialUserMessage: Message = {
      role: "user",
      blocks: [
        {
          type: "text",
          content: "请执行几个命令来获取系统信息",
        },
      ],
    };

    aiManager.setMessages([initialUserMessage]);

    // 重新初始化计数器，确保测试间隔离
    aiServiceCallCount = 0;

    const mockCallAgent = vi.mocked(aiService.callAgent);
    const { toolRegistry } = await import("@/tools/index.js");
    const mockToolExecute = vi.mocked(toolRegistry.execute);

    mockCallAgent.mockImplementation(async () => {
      aiServiceCallCount++;

      if (aiServiceCallCount === 1) {
        // 第一次：执行第一个工具
        return {
          tool_calls: [
            {
              id: "call_001",
              type: "function" as const,
              index: 0,
              function: {
                name: "run_terminal_cmd",
                arguments: JSON.stringify({ command: "pwd" }),
              },
            },
          ],
        };
      } else if (aiServiceCallCount === 2) {
        // 第二次：执行第二个工具
        return {
          tool_calls: [
            {
              id: "call_002",
              type: "function" as const,
              index: 0,
              function: {
                name: "run_terminal_cmd",
                arguments: JSON.stringify({ command: "date" }),
              },
            },
          ],
        };
      } else if (aiServiceCallCount === 3) {
        // 第三次：返回最终回答
        return {
          content: "我已经执行了所有必要的命令，获得了当前路径和时间信息。",
        };
      }

      return {};
    });

    // Mock 工具执行 - 根据工具名称返回不同结果
    mockToolExecute.mockImplementation(async (toolName, args) => {
      if (args.command === "pwd") {
        return {
          success: true,
          content: "/test/workdir",
          shortResult: "Current directory: /test/workdir",
        };
      } else if (args.command === "date") {
        return {
          success: true,
          content: "Mon Jan  1 12:00:00 UTC 2024",
          shortResult: "Current date and time",
        };
      }
      return {
        success: false,
        content: "Unknown command",
        error: "Command not recognized",
      };
    });

    // 调用 sendAIMessage 触发工具递归
    await aiManager.sendAIMessage();

    // 验证 AI service 被调用了3次
    expect(mockCallAgent).toHaveBeenCalledTimes(3);
    expect(aiServiceCallCount).toBe(3);

    // 验证工具被执行了2次
    expect(mockToolExecute).toHaveBeenCalledTimes(2);

    // 验证第一个工具调用
    expect(mockToolExecute).toHaveBeenNthCalledWith(
      1,
      "run_terminal_cmd",
      { command: "pwd" },
      expect.objectContaining({
        abortSignal: expect.any(AbortSignal),
      }),
    );

    // 验证第二个工具调用
    expect(mockToolExecute).toHaveBeenNthCalledWith(
      2,
      "run_terminal_cmd",
      { command: "date" },
      expect.objectContaining({
        abortSignal: expect.any(AbortSignal),
      }),
    );

    // 验证最后一次 AI 调用包含了所有工具执行结果
    const finalCall = mockCallAgent.mock.calls[2][0];
    const toolMessages = finalCall.messages.filter(
      (msg) => msg.role === "tool",
    );
    expect(toolMessages).toHaveLength(2);

    // 验证工具消息的内容
    const pwdToolMessage = toolMessages.find(
      (msg) => msg.tool_call_id === "call_001",
    );
    expect(pwdToolMessage?.content).toBe("/test/workdir");

    const dateToolMessage = toolMessages.find(
      (msg) => msg.tool_call_id === "call_002",
    );
    expect(dateToolMessage?.content).toBe("Mon Jan  1 12:00:00 UTC 2024");
  });

  it("should handle tool execution errors gracefully", async () => {
    // 添加初始用户消息
    const initialUserMessage: Message = {
      role: "user",
      blocks: [
        {
          type: "text",
          content: "请执行一个会失败的命令",
        },
      ],
    };

    aiManager.setMessages([initialUserMessage]);

    aiServiceCallCount = 0;

    const mockCallAgent = vi.mocked(aiService.callAgent);
    const { toolRegistry } = await import("@/tools/index.js");
    const mockToolExecute = vi.mocked(toolRegistry.execute);

    mockCallAgent.mockImplementation(async () => {
      aiServiceCallCount++;

      if (aiServiceCallCount === 1) {
        // 第一次：返回工具调用
        return {
          tool_calls: [
            {
              id: "call_error",
              type: "function" as const,
              index: 0,
              function: {
                name: "run_terminal_cmd",
                arguments: JSON.stringify({ command: "invalid-command" }),
              },
            },
          ],
        };
      } else if (aiServiceCallCount === 2) {
        // 第二次：基于错误结果返回响应
        return {
          content: "看起来命令执行失败了，让我为您提供其他帮助。",
        };
      }

      return {};
    });

    // Mock 工具执行失败
    mockToolExecute.mockResolvedValue({
      success: false,
      content: "Error: command not found: invalid-command",
      error: "command not found: invalid-command",
      shortResult: "Command failed",
    });

    // 调用 sendAIMessage 触发工具递归
    await aiManager.sendAIMessage();

    // 验证 AI service 被调用了两次（即使工具失败也会触发递归）
    expect(mockCallAgent).toHaveBeenCalledTimes(2);
    expect(aiServiceCallCount).toBe(2);

    // 验证工具被执行了一次
    expect(mockToolExecute).toHaveBeenCalledTimes(1);

    // 验证第二次 AI 调用包含了错误信息
    const secondCall = mockCallAgent.mock.calls[1][0];
    const toolMessage = secondCall.messages.find((msg) => msg.role === "tool");
    expect(toolMessage).toBeDefined();
    expect(toolMessage?.tool_call_id).toBe("call_error");
    expect(toolMessage?.content).toContain("Error: command not found");
  });

  it("should stop recursion when no more tool calls are returned", async () => {
    // 添加初始用户消息
    const initialUserMessage: Message = {
      role: "user",
      blocks: [
        {
          type: "text",
          content: "请帮我做一些任务",
        },
      ],
    };

    aiManager.setMessages([initialUserMessage]);

    aiServiceCallCount = 0;

    const mockCallAgent = vi.mocked(aiService.callAgent);
    const { toolRegistry } = await import("@/tools/index.js");
    const mockToolExecute = vi.mocked(toolRegistry.execute);

    mockCallAgent.mockImplementation(async () => {
      aiServiceCallCount++;

      if (aiServiceCallCount === 1) {
        // 第一次：返回工具调用
        return {
          tool_calls: [
            {
              id: "call_final",
              type: "function" as const,
              index: 0,
              function: {
                name: "run_terminal_cmd",
                arguments: JSON.stringify({ command: "echo 'task completed'" }),
              },
            },
          ],
        };
      } else if (aiServiceCallCount === 2) {
        // 第二次：只返回内容，不返回工具调用 - 应该停止递归
        return {
          content: "任务已完成！我执行了命令并得到了结果。",
        };
      }

      // 不应该到达这里
      return {
        content: "意外的第三次调用",
      };
    });

    // Mock 工具执行
    mockToolExecute.mockResolvedValue({
      success: true,
      content: "task completed",
      shortResult: "Echo command executed",
    });

    // 调用 sendAIMessage 触发工具递归
    await aiManager.sendAIMessage();

    // 验证 AI service 只被调用了两次（递归在没有更多工具调用时停止）
    expect(mockCallAgent).toHaveBeenCalledTimes(2);
    expect(aiServiceCallCount).toBe(2);

    // 验证工具只被执行了一次
    expect(mockToolExecute).toHaveBeenCalledTimes(1);
  });
});
