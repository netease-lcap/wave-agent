import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "ink-testing-library";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import React from "react";
import { App } from "../../src/components/App";
import * as aiService from "../../src/services/aiService";
import type { SessionData } from "../../src/services/sessionManager";
import {
  waitForAIThinkingStart,
  waitForAIThinkingEnd,
  waitForText,
} from "../helpers/waitHelpers";

// Mock AI Service
vi.mock("../../src/services/aiService");

describe("Message Compression Integration Tests", () => {
  let testDir: string;
  let sessionFile: string;

  beforeEach(async () => {
    // 创建临时测试目录
    testDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "compression-test-"),
    );

    // 创建 session 文件路径
    sessionFile = path.join(testDir, ".lcap_session.json");

    vi.clearAllMocks();
  });

  afterEach(async () => {
    // 清理测试目录
    await fs.promises.rm(testDir, { recursive: true, force: true });
  });

  // 辅助函数：生成指定数量的消息对话
  const generateMessages = (count: number) => {
    const messages = [];
    for (let i = 0; i < count; i++) {
      messages.push({
        role: "user" as const,
        blocks: [
          {
            type: "text" as const,
            content: `User message ${i + 1}: Please help me with task ${i + 1}`,
          },
        ],
      });
      messages.push({
        role: "assistant" as const,
        blocks: [
          {
            type: "text" as const,
            content: `Assistant response ${i + 1}: I'll help you with task ${i + 1}`,
          },
        ],
      });
    }
    return messages;
  };

  // 辅助函数：创建完整的 SessionData 对象
  const createMockSession = (id: string, messageCount: number): SessionData => {
    const now = new Date().toISOString();
    return {
      id,
      timestamp: now,
      version: "1.0.0",
      metadata: {
        workdir: testDir,
        startedAt: now,
        lastActiveAt: now,
        totalTokens: 0,
      },
      state: {
        messages: generateMessages(messageCount),
        inputHistory: [],
      },
    };
  };

  it("should trigger compression when token usage exceeds 64k during session restore", async () => {
    // 创建一个包含足够多消息的 mock session（生成8对消息，共16条）
    const mockSession = createMockSession("test-session-compression", 8);

    // 写入 session 文件
    await fs.promises.writeFile(
      sessionFile,
      JSON.stringify(mockSession),
      "utf-8",
    );

    let compressMessagesCalled = false;

    // Mock AI 服务
    const mockCallAgent = vi.mocked(aiService.callAgent);
    const mockCompressMessages = vi.mocked(aiService.compressMessages);

    mockCallAgent.mockImplementation(async () => {
      // 返回高 token 使用量来触发压缩
      return {
        content: "I understand your request. Let me help you with that.",
        usage: {
          prompt_tokens: 50000,
          completion_tokens: 20000,
          total_tokens: 70000, // 超过 64000 触发压缩
        },
      };
    });

    mockCompressMessages.mockImplementation(async () => {
      compressMessagesCalled = true;
      return "压缩内容：之前的对话涉及多个任务请求和相应的处理。";
    });

    // 渲染 App 组件并传入要恢复的 session
    const renderResult = render(
      <App workdir={testDir} sessionToRestore={mockSession} />,
    );
    const { stdin } = renderResult;

    // 等待 session 恢复完成
    await waitForText(renderResult, "Type your message", { timeout: 10000 });

    // 发送一个新消息来触发 AI 调用（这会触发压缩）
    stdin.write("Please optimize the component performance");
    await new Promise((resolve) => setTimeout(resolve, 50));
    stdin.write("\r");

    // 等待 AI 处理开始和结束
    await waitForAIThinkingStart(renderResult);
    await waitForAIThinkingEnd(renderResult);

    // 验证 AI 服务被调用
    expect(mockCallAgent).toHaveBeenCalledTimes(1);

    // 验证压缩函数被调用（因为 token 使用量超过了 64k）
    expect(compressMessagesCalled).toBe(true);
    expect(mockCompressMessages).toHaveBeenCalledTimes(1);

    // 验证压缩函数被调用时的参数
    const compressCall = mockCompressMessages.mock.calls[0];
    expect(compressCall[0]).toHaveProperty("messages");
    expect(Array.isArray(compressCall[0].messages)).toBe(true);
    expect(compressCall[0].messages.length).toBeGreaterThan(0);

    // 验证 compressCall 里的 messages 应该包括 user1 到 user6
    const messages = compressCall[0].messages;
    const userMessages = messages.filter((msg) => msg.role === "user");

    // 验证包含user1到user6的消息内容
    for (let i = 1; i <= 6; i++) {
      const expectedUserContent = `User message ${i}: Please help me with task ${i}`;
      const hasUserMessage = userMessages.some((msg) => {
        if (typeof msg.content === "string")
          return msg.content === expectedUserContent;
        if (msg.content[0].type === "text") {
          return msg.content[0].text === expectedUserContent;
        }
      });
      expect(hasUserMessage).toBe(true);
    }
  }, 15000); // 增加超时时间到 15 秒

  it("should not trigger compression when token usage is below threshold", async () => {
    // 创建一个较小的 session（只生成1对消息，共2条）
    const mockSession = createMockSession("test-session-no-compression", 1);

    // 写入 session 文件
    await fs.promises.writeFile(
      sessionFile,
      JSON.stringify(mockSession),
      "utf-8",
    );

    let compressMessagesCalled = false;

    // Mock AI 服务返回低 token 使用量
    const mockCallAgent = vi.mocked(aiService.callAgent);
    const mockCompressMessages = vi.mocked(aiService.compressMessages);

    mockCallAgent.mockImplementation(async () => {
      return {
        content: "Sure, I can help with that.",
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150, // 远低于 64000
        },
      };
    });

    mockCompressMessages.mockImplementation(async () => {
      compressMessagesCalled = true;
      return "This should not be called";
    });

    // 渲染 App 组件
    const renderResult = render(
      <App workdir={testDir} sessionToRestore={mockSession} />,
    );
    const { stdin } = renderResult;

    // 等待组件渲染完成
    await waitForText(renderResult, "Type your message", { timeout: 10000 });

    // 发送消息
    stdin.write("How are you?");
    await new Promise((resolve) => setTimeout(resolve, 50));
    stdin.write("\r");

    // 等待处理完成
    await waitForAIThinkingStart(renderResult);
    await waitForAIThinkingEnd(renderResult);

    // 验证 AI 服务被调用但压缩函数未被调用
    expect(mockCallAgent).toHaveBeenCalledTimes(1);
    expect(compressMessagesCalled).toBe(false);
    expect(mockCompressMessages).toHaveBeenCalledTimes(0);
  }, 10000); // 增加超时时间

  it("should handle compression errors gracefully", async () => {
    // 创建包含足够多消息的 session（生成10对消息，共20条）
    const mockSession = createMockSession("test-session-compression-error", 10);

    // 写入 session 文件
    await fs.promises.writeFile(
      sessionFile,
      JSON.stringify(mockSession),
      "utf-8",
    );

    // Mock AI 服务
    const mockCallAgent = vi.mocked(aiService.callAgent);
    const mockCompressMessages = vi.mocked(aiService.compressMessages);

    mockCallAgent.mockImplementation(async () => {
      return {
        content: "Response",
        usage: {
          prompt_tokens: 50000,
          completion_tokens: 20000,
          total_tokens: 70000, // 触发压缩
        },
      };
    });

    // Mock 压缩函数抛出错误
    mockCompressMessages.mockRejectedValue(new Error("Compression failed"));

    // 渲染 App 组件
    const renderResult = render(
      <App workdir={testDir} sessionToRestore={mockSession} />,
    );
    const { stdin } = renderResult;

    // 等待渲染完成
    await waitForText(renderResult, "Type your message", { timeout: 10000 });

    // 发送消息触发压缩
    stdin.write("Test message");
    await new Promise((resolve) => setTimeout(resolve, 50));
    stdin.write("\r");

    // 等待处理完成 - 即使压缩失败，应用也应该继续工作
    await waitForAIThinkingStart(renderResult);
    await waitForAIThinkingEnd(renderResult);

    // 验证调用情况
    expect(mockCallAgent).toHaveBeenCalledTimes(1);
    expect(mockCompressMessages).toHaveBeenCalledTimes(1);

    // 验证应用仍然正常运行（没有崩溃）
    expect(renderResult.lastFrame()).toContain("Type your message");
  }, 10000); // 增加超时时间
});
