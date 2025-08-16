import { describe, it, expect, vi, beforeEach } from "vitest";
import { AIManager } from "../src/services/aiManager";
import * as aiService from "../src/services/aiService";
import { FileManager } from "../src/services/fileManager";
import { SessionManager } from "../src/services/sessionManager";
import { Message } from "@/types";

// Mock AI Service
vi.mock("../src/services/aiService");

// Mock File Manager
vi.mock("../src/services/fileManager");

// Mock Session Manager
vi.mock("../src/services/sessionManager");

// Mock memory utils to prevent file reading
vi.mock("../src/utils/memoryUtils", () => ({
  readMemoryFile: vi.fn(() => Promise.resolve("")),
  writeMemoryFile: vi.fn(() => Promise.resolve()),
}));

describe("AIManager Message Compression Tests", () => {
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
    aiManager = new AIManager("/mock/workdir", mockCallbacks, mockFileManager);

    vi.clearAllMocks();
  });

  // 辅助函数：生成指定数量的消息对话
  const generateMessages = (count: number): Message[] => {
    const messages: Message[] = [];
    for (let i = 0; i < count; i++) {
      messages.push({
        role: "user",
        blocks: [
          {
            type: "text",
            content: `User message ${i + 1}: Please help me with task ${i + 1}`,
          },
        ],
      });
      messages.push({
        role: "assistant",
        blocks: [
          {
            type: "text",
            content: `Assistant response ${i + 1}: I'll help you with task ${i + 1}`,
          },
        ],
      });
    }
    return messages;
  };

  it("should trigger compression when token usage exceeds 64k", async () => {
    // 创建包含足够多消息的历史（生成8对消息，共16条）
    const messages = generateMessages(8);

    // 添加一个新的用户消息来触发 AI 调用
    const newUserMessage: Message = {
      role: "user",
      blocks: [
        {
          type: "text",
          content: "Please optimize the component performance",
        },
      ],
    };

    // 设置 AI Manager 的消息历史（包括新的用户消息）
    aiManager.setMessages([...messages, newUserMessage]);

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

    // 调用 sendAIMessage 来触发 AI 调用（这会触发压缩）
    await aiManager.sendAIMessage();

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
    const messagesToCompress = compressCall[0].messages;
    const userMessages = messagesToCompress.filter(
      (msg) => msg.role === "user",
    );

    // 验证包含user1到user6的消息内容
    for (let i = 1; i <= 6; i++) {
      const expectedUserContent = `User message ${i}: Please help me with task ${i}`;
      const hasUserMessage = userMessages.some((msg) => {
        if (typeof msg.content === "string") {
          return msg.content === expectedUserContent;
        }
        if (Array.isArray(msg.content) && msg.content[0].type === "text") {
          return msg.content[0].text === expectedUserContent;
        }
        return false;
      });
      expect(hasUserMessage).toBe(true);
    }
  });

  it("should not trigger compression when token usage is below threshold", async () => {
    // 创建一个较小的消息历史（只生成1对消息，共2条）
    const messages = generateMessages(1);

    // 添加一个新的用户消息来触发 AI 调用
    const newUserMessage: Message = {
      role: "user",
      blocks: [
        {
          type: "text",
          content: "How are you?",
        },
      ],
    };

    // 设置 AI Manager 的消息历史（包括新的用户消息）
    aiManager.setMessages([...messages, newUserMessage]);

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

    // 调用 sendAIMessage
    await aiManager.sendAIMessage();

    // 验证 AI 服务被调用但压缩函数未被调用
    expect(mockCallAgent).toHaveBeenCalledTimes(1);
    expect(compressMessagesCalled).toBe(false);
    expect(mockCompressMessages).toHaveBeenCalledTimes(0);
  });

  it("should handle compression errors gracefully", async () => {
    // 创建包含足够多消息的历史（生成10对消息，共20条）
    const messages = generateMessages(10);

    // 添加一个新的用户消息来触发 AI 调用
    const newUserMessage: Message = {
      role: "user",
      blocks: [
        {
          type: "text",
          content: "Test message",
        },
      ],
    };

    // 设置 AI Manager 的消息历史（包括新的用户消息）
    aiManager.setMessages([...messages, newUserMessage]);

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

    // 调用 sendAIMessage 触发压缩
    await aiManager.sendAIMessage();

    // 验证调用情况
    expect(mockCallAgent).toHaveBeenCalledTimes(1);
    expect(mockCompressMessages).toHaveBeenCalledTimes(1);

    // 验证即使压缩失败，AI 调用仍然成功（不抛出异常）
    // 如果这里没有抛出异常，说明错误处理是正确的
  });

  it("should compress messages from 7th last to previous compressed message when session already contains compression", async () => {
    // 测试场景：当会话中已经包含压缩消息时，新的压缩操作应该只压缩从上一个压缩点到倒数第8条消息之间的内容

    // 创建初始的15对消息（30条消息）
    const initialMessages = generateMessages(15);

    // 在第9个位置插入一个压缩消息（代表之前的压缩）
    const messagesWithCompression: Message[] = [
      ...initialMessages.slice(0, 8), // 前8条消息
      {
        role: "assistant",
        blocks: [
          {
            type: "compress",
            content: "压缩内容：包含了前面6条消息的总结",
          },
        ],
      },
      ...initialMessages.slice(8), // 后面的消息
    ];

    // 添加一个新的用户消息来触发 AI 调用
    const newUserMessage: Message = {
      role: "user",
      blocks: [
        {
          type: "text",
          content: "Trigger compression again",
        },
      ],
    };

    // 设置 AI Manager 的消息历史（包括新的用户消息）
    aiManager.setMessages([...messagesWithCompression, newUserMessage]);

    // Mock AI 服务
    const mockCallAgent = vi.mocked(aiService.callAgent);
    const mockCompressMessages = vi.mocked(aiService.compressMessages);

    mockCallAgent.mockImplementation(async () => {
      return {
        content: "I understand your request.",
        usage: {
          prompt_tokens: 50000,
          completion_tokens: 20000,
          total_tokens: 70000, // 超过 64000 触发压缩
        },
      };
    });

    mockCompressMessages.mockImplementation(async () => {
      return "新的压缩内容：包含了更多消息的总结";
    });

    // 调用 sendAIMessage 触发压缩
    await aiManager.sendAIMessage();

    // 验证压缩函数被调用
    expect(mockCompressMessages).toHaveBeenCalledTimes(1);

    // 验证压缩函数被调用时的参数
    const compressCall = mockCompressMessages.mock.calls[0];
    expect(compressCall[0]).toHaveProperty("messages");
    expect(Array.isArray(compressCall[0].messages)).toBe(true);
    expect(compressCall[0].messages.length).toBeGreaterThan(0);

    // 验证 compressCall 里的 messages 应该是从倒数第7条到上一个压缩消息之间的消息
    const messagesToCompress = compressCall[0].messages;

    // 检查压缩的消息范围：应该从压缩消息之后到倒数第8条消息（因为保留最近7条）
    const userMessages = messagesToCompress.filter(
      (msg) => msg.role === "user",
    );

    // 验证包含的消息内容（应该包含压缩消息之后的一些用户消息）
    // 根据我们的设置，压缩消息在第9个位置，所以之后应该从 "User message 5" 开始
    const hasUser5 = userMessages.some((msg) => {
      const content = Array.isArray(msg.content)
        ? msg.content
            .map((part) => (part.type === "text" ? part.text : ""))
            .join(" ")
        : msg.content;
      return (
        content &&
        content.includes("User message 5: Please help me with task 5")
      );
    });
    expect(hasUser5).toBe(true);

    // 验证包含到倒数第7条的消息（应该包含 User message 13，因为最后一条是我们新发送的消息）
    const hasUser13 = userMessages.some((msg) => {
      const content = Array.isArray(msg.content)
        ? msg.content
            .map((part) => (part.type === "text" ? part.text : ""))
            .join(" ")
        : msg.content;
      return (
        content &&
        content.includes("User message 13: Please help me with task 13")
      );
    });
    expect(hasUser13).toBe(true);

    // 验证应该包含前一个压缩消息作为上下文（这是期望的行为）
    // convertMessagesForAPI 会将压缩消息转换为系统消息格式
    const hasCompressedMessage = messagesToCompress.some(
      (msg) =>
        msg.role === "system" &&
        typeof msg.content === "string" &&
        msg.content.includes("压缩内容：包含了前面6条消息的总结"),
    );
    expect(hasCompressedMessage).toBe(true);

    // 验证不应该包含最新的几条消息（应该保留最新的几条不被压缩）
    // 最新的用户消息应该是 User message 15，它不应该在压缩的消息中
    const hasLatestUser = userMessages.some((msg) => {
      const content = Array.isArray(msg.content)
        ? msg.content
            .map((part) => (part.type === "text" ? part.text : ""))
            .join(" ")
        : msg.content;
      return content && content.includes("User message 15");
    });
    expect(hasLatestUser).toBe(false);
  });
});
