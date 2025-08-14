import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render } from "ink-testing-library";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import React from "react";
import { App } from "../../src/components/App";
import * as aiService from "../../src/services/aiService";
import type { ChatCompletionMessageParam } from "../../src/types/common";
import {
  waitForAIThinkingStart,
  waitForAIThinkingEnd,
  waitForText,
} from "../helpers/waitHelpers";

// Mock AI Service
vi.mock("../../src/services/aiService");

// Use real terminal tool execution for more realistic testing

describe("Tool Recursion Integration Tests", () => {
  let testDir: string;
  let aiServiceCallCount = 0;
  let capturedMessages: ChatCompletionMessageParam[][] = [];

  beforeEach(async () => {
    // 创建临时测试目录
    testDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "tool-recursion-test-"),
    );

    // 创建一个简单的测试文件
    const testFilePath = path.join(testDir, "test.txt");
    await fs.promises.writeFile(testFilePath, "Hello World!", "utf-8");

    // 重置所有 mocks
    vi.clearAllMocks();
    aiServiceCallCount = 0;
    capturedMessages = [];
  });

  afterEach(async () => {
    // 清理测试目录
    await fs.promises.rm(testDir, { recursive: true, force: true });
  });

  it("should trigger recursive AI call after tool execution and verify message structure", async () => {
    // Mock AI service 返回工具调用，然后在第二次调用时返回简单响应
    const mockCallAgent = vi.mocked(aiService.callAgent);

    mockCallAgent.mockImplementation(async ({ messages }) => {
      // 捕获传入的消息以供后续验证
      capturedMessages.push([...messages]);
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

    // 渲染 App 组件
    const renderResult = render(<App workdir={testDir} />);
    const { stdin } = renderResult;

    // 等待组件完全渲染，确保初始状态显示
    await waitForText(renderResult, "Type your message", { timeout: 3000 });

    // 模拟用户输入消息来触发 AI 服务
    stdin.write("请查看当前目录的内容");
    await new Promise((resolve) => setTimeout(resolve, 50));

    // 模拟按下回车键发送消息
    stdin.write("\r");

    // 等待 AI is thinking 文案出现
    await waitForAIThinkingStart(renderResult);

    // 等待 AI is thinking 文案消失，表示所有AI调用都完成
    await waitForAIThinkingEnd(renderResult);

    // 验证 AI service 被调用了两次
    expect(mockCallAgent).toHaveBeenCalledTimes(2);
    expect(aiServiceCallCount).toBe(2);

    // 验证第一次调用的消息结构
    const firstCallMessages = capturedMessages[0];
    expect(firstCallMessages).toHaveLength(1);
    expect(firstCallMessages[0].role).toBe("user");
    expect(firstCallMessages[0].content).toBeDefined();
    if (Array.isArray(firstCallMessages[0].content)) {
      expect(firstCallMessages[0].content[0]).toEqual({
        type: "text",
        text: "请查看当前目录的内容",
      });
    }

    // 验证第二次调用的消息结构应该包含工具执行结果
    const secondCallMessages = capturedMessages[1];
    expect(secondCallMessages.length).toBeGreaterThan(1);

    // 应该包含原始用户消息
    const userMessage = secondCallMessages.find((msg) => msg.role === "user");
    expect(userMessage).toBeDefined();
    expect(userMessage?.content).toBeDefined();

    // 应该包含助手的工具调用消息
    const assistantMessage = secondCallMessages.find(
      (msg) => msg.role === "assistant",
    );
    expect(assistantMessage).toBeDefined();
    expect(assistantMessage?.tool_calls).toBeDefined();
    const toolCall = assistantMessage?.tool_calls?.[0];
    expect(toolCall?.type).toBe("function");
    if (toolCall?.type === "function") {
      expect(toolCall.function?.name).toBe("run_terminal_cmd");
      // 验证 arguments 参数的详细结构
      expect(toolCall.function?.arguments).toBeDefined();
      const parsedArgs = JSON.parse(toolCall.function?.arguments || "{}");
      expect(parsedArgs).toHaveProperty("command");
      expect(parsedArgs.command).toBe("ls -la .");
      expect(typeof parsedArgs.command).toBe("string");
    }

    // 应该包含工具执行结果消息
    const toolMessage = secondCallMessages.find((msg) => msg.role === "tool");
    expect(toolMessage).toBeDefined();
    expect(toolMessage?.tool_call_id).toBe("call_123");
    expect(toolMessage?.content).toBeDefined(); // 验证工具执行有输出
  });

  it("should handle multiple tool calls in sequence", async () => {
    // 重新初始化计数器和消息数组，确保测试间隔离
    aiServiceCallCount = 0;
    capturedMessages = [];

    const mockCallAgent = vi.mocked(aiService.callAgent);

    mockCallAgent.mockImplementation(async ({ messages }) => {
      capturedMessages.push([...messages]);
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

    const renderResult = render(<App workdir={testDir} />);
    const { stdin } = renderResult;

    // 等待组件完全渲染，确保初始状态显示
    await waitForText(renderResult, "Type your message", { timeout: 3000 });

    // 模拟用户输入消息来触发 AI 服务
    stdin.write("请执行多个命令");
    await new Promise((resolve) => setTimeout(resolve, 50));

    // 模拟按下回车键发送消息
    stdin.write("\r");

    // 等待 AI is thinking 文案出现
    await waitForAIThinkingStart(renderResult);

    // 等待 AI is thinking 文案消失，表示所有AI调用都完成
    await waitForAIThinkingEnd(renderResult);

    // 验证进行了三次 AI 调用
    expect(mockCallAgent).toHaveBeenCalledTimes(3);
    expect(aiServiceCallCount).toBe(3);

    // 验证第三次调用包含了之前所有的工具调用和结果
    const thirdCallMessages = capturedMessages[2];
    const toolMessages = thirdCallMessages.filter((msg) => msg.role === "tool");
    expect(toolMessages).toHaveLength(2);

    // 验证工具调用 ID 的正确性
    const toolCallIds = toolMessages.map((msg) => msg.tool_call_id);
    expect(toolCallIds).toContain("call_001");
    expect(toolCallIds).toContain("call_002");
  });
});
