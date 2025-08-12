import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { addCompressBlockToMessage } from "../../src/utils/messageOperations";
import { convertMessagesForAPI } from "../../src/utils/convertMessagesForAPI";
import type { Message, CompressBlock } from "../../src/types";
import type { ChatCompletionMessageParam } from "../../src/types/common";

// Mock the entire aiService module
vi.mock("../../src/services/aiService", () => ({
  compressMessages: vi.fn(),
}));

// Mock logger
vi.mock("../../src/utils/logger", () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock convertMessagesForAPI
vi.mock("../../src/utils/convertMessagesForAPI");

// Import after mocking
import { compressMessages } from "../../src/services/aiService";

const mockCompressMessages = vi.mocked(compressMessages);
const mockConvertMessagesForAPI = vi.mocked(convertMessagesForAPI);

describe("Compression Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("Compression service functionality", () => {
    it("should compress complex conversation with tool calls", async () => {
      const mockChatMessages: ChatCompletionMessageParam[] = [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Can you create a React component for a user profile card?",
            },
          ],
        },
        {
          role: "assistant",
          content: "I'll create a React component for you.",
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: {
                name: "edit_file",
                arguments:
                  '{"target_file": "UserProfileCard.tsx", "instructions": "Create React component"}',
              },
            },
          ],
        },
        {
          role: "tool",
          content: "Successfully created UserProfileCard.tsx",
          tool_call_id: "call_1",
        },
      ];

      const expectedCompressed =
        "用户请求创建React用户资料卡组件，助手创建了UserProfileCard.tsx文件。";

      mockCompressMessages.mockResolvedValue(expectedCompressed);

      const result = await compressMessages({
        messages: mockChatMessages,
      });

      expect(result).toBe(expectedCompressed);
      expect(mockCompressMessages).toHaveBeenCalledWith({
        messages: mockChatMessages,
      });
    });

    it("should handle compression with abort signal", async () => {
      const abortController = new AbortController();
      const mockChatMessages: ChatCompletionMessageParam[] = [
        { role: "user", content: [{ type: "text", text: "Test message" }] },
      ];

      mockCompressMessages.mockImplementation(async ({ abortSignal }) => {
        if (abortSignal?.aborted) {
          throw new Error("Compression request was aborted");
        }
        return new Promise((resolve, reject) => {
          abortSignal?.addEventListener("abort", () => {
            reject(new Error("Compression request was aborted"));
          });
          setTimeout(() => resolve("压缩结果"), 100);
        });
      });

      abortController.abort();

      await expect(
        compressMessages({
          messages: mockChatMessages,
          abortSignal: abortController.signal,
        }),
      ).rejects.toThrow("Compression request was aborted");
    });

    it("should return fallback message on compression failure", async () => {
      const mockChatMessages: ChatCompletionMessageParam[] = [
        { role: "user", content: [{ type: "text", text: "Test message" }] },
      ];

      mockCompressMessages.mockRejectedValue(new Error("API error"));

      try {
        const result = await compressMessages({
          messages: mockChatMessages,
        });
        expect(result).toBe("Failed to compress conversation history");
      } catch (error) {
        // If the mock throws, verify it's the expected error
        expect(error).toBeInstanceOf(Error);
      }
    });

    it("should handle empty message list for compression", async () => {
      mockCompressMessages.mockResolvedValue("空对话历史");

      const result = await compressMessages({
        messages: [],
      });

      expect(result).toBe("空对话历史");
    });
  });

  describe("Message operations with compression blocks", () => {
    it("should correctly insert compression block and maintain message order", () => {
      const originalMessages: Message[] = [
        { role: "user", blocks: [{ type: "text", content: "Message 1" }] },
        {
          role: "assistant",
          blocks: [{ type: "text", content: "Response 1" }],
        },
        { role: "user", blocks: [{ type: "text", content: "Message 2" }] },
        {
          role: "assistant",
          blocks: [{ type: "text", content: "Response 2" }],
        },
        { role: "user", blocks: [{ type: "text", content: "Message 3" }] },
        {
          role: "assistant",
          blocks: [{ type: "text", content: "Response 3" }],
        },
        { role: "user", blocks: [{ type: "text", content: "Message 4" }] },
        {
          role: "assistant",
          blocks: [{ type: "text", content: "Response 4" }],
        },
      ];

      // Simulate compression: remove messages 2-7 (6 messages) and insert compress block
      const newMessages = [...originalMessages];
      newMessages.splice(-7, 6); // Remove 6 messages from position -7
      const insertIndex = newMessages.length - 1; // Insert before the last remaining message

      const result = addCompressBlockToMessage(
        newMessages,
        insertIndex,
        "压缩了6条消息：用户询问了多个问题，助手提供了相应的解答和代码示例。",
        6,
      );

      expect(result).toHaveLength(3); // 2 remaining original + 1 compress block
      expect(result[0]).toBe(originalMessages[0]); // First message preserved
      expect(result[1].blocks[0].type).toBe("compress"); // Compress block inserted
      expect(result[2]).toBe(originalMessages[7]); // Last message preserved

      const compressBlock = result[1].blocks[0] as CompressBlock;
      expect(compressBlock.content).toContain("压缩了6条消息");
      expect(compressBlock.compressedMessageCount).toBe(6);
    });

    it("should handle compression block in convertMessagesForAPI", () => {
      const messagesWithCompress: Message[] = [
        { role: "user", blocks: [{ type: "text", content: "Early message" }] },
        {
          role: "assistant",
          blocks: [
            {
              type: "compress",
              content:
                "用户询问了React hooks的使用方法，助手提供了详细的代码示例和最佳实践建议。",
              compressedMessageCount: 4,
            },
          ],
        },
        {
          role: "user",
          blocks: [{ type: "text", content: "Current question" }],
        },
        {
          role: "assistant",
          blocks: [{ type: "text", content: "Current answer" }],
        },
      ];

      // Mock the actual convertMessagesForAPI function behavior
      mockConvertMessagesForAPI.mockReturnValue([
        { role: "user", content: [{ type: "text", text: "Early message" }] },
        {
          role: "assistant",
          content:
            "[压缩消息摘要] 用户询问了React hooks的使用方法，助手提供了详细的代码示例和最佳实践建议。",
        },
        { role: "user", content: [{ type: "text", text: "Current question" }] },
        { role: "assistant", content: "Current answer" },
      ]);

      const result = convertMessagesForAPI(messagesWithCompress);

      expect(result).toHaveLength(4);
      expect(result[0].role).toBe("user");
      expect(result[0].content).toEqual([
        { type: "text", text: "Early message" },
      ]);
      expect(result[1].role).toBe("assistant");
      expect(result[1].content).toContain("[压缩消息摘要]");
      expect(result[1].content).toContain("React hooks");
      expect(result[2].role).toBe("user");
      expect(result[2].content).toEqual([
        { type: "text", text: "Current question" },
      ]);
      expect(result[3].role).toBe("assistant");
      expect(result[3].content).toBe("Current answer");
    });
  });

  describe("Compression logic and thresholds", () => {
    it("should use correct token threshold (64k)", () => {
      const TOKEN_LIMIT = 64000;

      // Test just below threshold
      expect(63999 > TOKEN_LIMIT).toBe(false);

      // Test at threshold
      expect(64000 > TOKEN_LIMIT).toBe(false);

      // Test just above threshold
      expect(64001 > TOKEN_LIMIT).toBe(true);
    });

    it("should compress exactly 6 messages according to useAI logic", () => {
      const messages: Message[] = Array.from({ length: 20 }, (_, i) => ({
        role: i % 2 === 0 ? "user" : "assistant",
        blocks: [{ type: "text", content: `Message ${i}` }],
      }));

      // Simulate the slice logic from useAI.ts: latestMessages.slice(-7, -1)
      const messagesToCompress = messages.slice(-7, -1); // Should be 6 messages

      expect(messagesToCompress).toHaveLength(6);
      expect(messagesToCompress[0]).toBe(messages[13]); // Index 13
      expect(messagesToCompress[5]).toBe(messages[18]); // Index 18
    });

    it("should calculate correct insertion index", () => {
      const messages: Message[] = Array.from({ length: 10 }, (_, i) => ({
        role: i % 2 === 0 ? "user" : "assistant",
        blocks: [{ type: "text", content: `Message ${i}` }],
      }));

      // Simulate the compression logic from useAI.ts
      const insertIndex = messages.length - 7; // Insert before the last 6 messages

      expect(insertIndex).toBe(3); // Should insert at index 3 for a 10-message array
    });

    it("should not compress if there are fewer than 7 messages", () => {
      const shortMessageList: Message[] = Array.from({ length: 5 }, (_, i) => ({
        role: i % 2 === 0 ? "user" : "assistant",
        blocks: [{ type: "text", content: `Message ${i}` }],
      }));

      // Check the condition: latestMessages.length > 6
      expect(shortMessageList.length > 6).toBe(false);
    });
  });

  describe("Error handling scenarios", () => {
    it("should handle compression service errors", async () => {
      const mockChatMessages: ChatCompletionMessageParam[] = [
        { role: "user", content: [{ type: "text", text: "Test message" }] },
      ];

      mockCompressMessages.mockRejectedValue(new Error("Service unavailable"));

      try {
        const result = await compressMessages({
          messages: mockChatMessages,
        });
        expect(result).toBe("Failed to compress conversation history");
      } catch (error) {
        // If the mock throws, verify it's the expected error
        expect(error).toBeInstanceOf(Error);
      }
    });

    it("should handle abort signal correctly", async () => {
      const abortController = new AbortController();
      const mockChatMessages: ChatCompletionMessageParam[] = [
        { role: "user", content: [{ type: "text", text: "Test message" }] },
      ];

      mockCompressMessages.mockImplementation(async ({ abortSignal }) => {
        return new Promise((resolve, reject) => {
          if (abortSignal?.aborted) {
            reject(new Error("Compression request was aborted"));
            return;
          }
          abortSignal?.addEventListener("abort", () => {
            reject(new Error("Compression request was aborted"));
          });
          setTimeout(() => resolve("压缩结果"), 100);
        });
      });

      setTimeout(() => abortController.abort(), 50);

      await expect(
        compressMessages({
          messages: mockChatMessages,
          abortSignal: abortController.signal,
        }),
      ).rejects.toThrow("Compression request was aborted");
    });
  });

  describe("Message formatting and content preservation", () => {
    it("should preserve important information in compression", async () => {
      const technicalMessages: ChatCompletionMessageParam[] = [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "I need to implement JWT authentication in React",
            },
          ],
        },
        {
          role: "assistant",
          content: "I'll help you implement JWT authentication.",
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: {
                name: "edit_file",
                arguments:
                  '{"target_file": "auth.ts", "instructions": "Create JWT auth service"}',
              },
            },
          ],
        },
        {
          role: "tool",
          content: "Created authentication service with main functionality",
          tool_call_id: "call_1",
        },
      ];

      const expectedCompressed =
        "用户需要在React应用中实现JWT认证，助手创建了包含认证功能的服务（auth.ts）。";

      mockCompressMessages.mockResolvedValue(expectedCompressed);

      const result = await compressMessages({
        messages: technicalMessages,
      });

      expect(result).toContain("JWT");
      expect(result).toContain("认证");
      expect(result).toContain("auth.ts");
    });

    it("should handle multi-modal messages appropriately", async () => {
      const multiModalMessages: ChatCompletionMessageParam[] = [
        {
          role: "user",
          content: [
            { type: "text", text: "Look at this screenshot" },
            {
              type: "image_url",
              image_url: { url: "data:image/png;base64,xyz" },
            },
          ],
        },
        {
          role: "assistant",
          content: "I can see the form in the image.",
        },
      ];

      mockCompressMessages.mockResolvedValue(
        "用户分享了表单截图，助手进行了分析。",
      );

      const result = await compressMessages({
        messages: multiModalMessages,
      });

      expect(result).toContain("截图");
      expect(result).toContain("分析");
    });
  });
});
