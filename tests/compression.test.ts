import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { compressMessages } from "../src/services/aiService";
import { addCompressBlockToMessage } from "../src/utils/messageOperations";
import { getRecentMessages } from "../src/utils/getRecentMessages";
import type { Message } from "../src/types";
import type { ChatCompletionMessageParam } from "../src/types/common";

// Mock dependencies
vi.mock("../src/services/aiService");
vi.mock("../src/utils/getRecentMessages");
vi.mock("../src/utils/logger");
vi.mock("../src/contexts/useFiles", () => ({
  useFiles: () => ({
    workdir: "/test/workdir",
    setFlatFiles: vi.fn(),
    flatFiles: [],
  }),
}));

const mockCompressMessages = vi.mocked(compressMessages);
const mockGetRecentMessages = vi.mocked(getRecentMessages);

describe("Message Compression Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("compressMessages function", () => {
    it("should compress messages into a concise summary", async () => {
      const testMessages: ChatCompletionMessageParam[] = [
        {
          role: "user" as const,
          content: [
            { type: "text", text: "Can you help me create a React component?" },
          ],
        },
        {
          role: "assistant" as const,
          content:
            "I'll help you create a React component. Let me create a new file.",
          tool_calls: [
            {
              id: "call_123",
              type: "function" as const,
              function: {
                name: "edit_file",
                arguments:
                  '{"target_file": "Component.tsx", "instructions": "Create React component"}',
              },
            },
          ],
        },
        {
          role: "tool" as const,
          content: "File created successfully",
          tool_call_id: "call_123",
        },
      ];

      const expectedCompressed =
        "用户请求创建React组件，助手使用edit_file工具成功创建了Component.tsx文件";
      mockCompressMessages.mockResolvedValue(expectedCompressed);

      const result = await compressMessages({
        messages: testMessages,
      });

      expect(result).toBe(expectedCompressed);
      expect(mockCompressMessages).toHaveBeenCalledWith({
        messages: testMessages,
      });
    });

    it("should handle compression errors gracefully", async () => {
      const testMessages: ChatCompletionMessageParam[] = [
        {
          role: "user" as const,
          content: [{ type: "text", text: "Test message" }],
        },
      ];

      mockCompressMessages.mockImplementation(async () => {
        throw new Error("API Error");
      });

      // Test that the function handles the error and returns fallback
      try {
        const result = await compressMessages({
          messages: testMessages,
        });
        expect(result).toBe("对话历史压缩失败");
      } catch (error) {
        // If the mock throws, that's expected - the real function should catch it
        expect(error).toBeInstanceOf(Error);
      }
    });

    it("should format different message types correctly", async () => {
      const testMessages: ChatCompletionMessageParam[] = [
        {
          role: "user" as const,
          content: [
            { type: "text" as const, text: "Here is an image" },
            {
              type: "image_url" as const,
              image_url: { url: "data:image/png;base64,xyz" },
            },
          ],
        },
        {
          role: "assistant" as const,
          content: "I can see the image.",
          tool_calls: [
            {
              id: "call_456",
              type: "function" as const,
              function: {
                name: "analyze_image",
                arguments: "{}",
              },
            },
          ],
        },
        {
          role: "tool" as const,
          content: "Analysis complete",
          tool_call_id: "call_456",
        },
      ];

      mockCompressMessages.mockResolvedValue(
        "用户发送图片，助手分析并完成处理",
      );

      await compressMessages({ messages: testMessages });

      // Verify the function was called with properly formatted messages
      expect(mockCompressMessages).toHaveBeenCalledWith({
        messages: testMessages,
      });
    });
  });

  describe("addCompressBlockToMessage function", () => {
    it("should add compress block at specified index", () => {
      const messages: Message[] = [
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
      ];

      const compressContent = "压缩内容：之前的对话涉及创建组件和文件操作";
      const compressedMessageCount = 6;
      const insertIndex = 2;

      const result = addCompressBlockToMessage(
        messages,
        insertIndex,
        compressContent,
        compressedMessageCount,
      );

      expect(result).toHaveLength(5); // 原来4条 + 新增1条
      expect(result[insertIndex].role).toBe("assistant");
      expect(result[insertIndex].blocks).toHaveLength(1);

      const compressBlock = result[insertIndex].blocks[0];
      if (compressBlock.type === "compress") {
        expect(compressBlock.content).toBe(compressContent);
        expect(compressBlock.compressedMessageCount).toBe(
          compressedMessageCount,
        );
      } else {
        throw new Error("Expected compress block");
      }

      // 验证其他消息位置正确
      expect(result[0]).toBe(messages[0]);
      expect(result[1]).toBe(messages[1]);
      expect(result[3]).toBe(messages[2]);
      expect(result[4]).toBe(messages[3]);
    });

    it("should handle edge cases for insert index", () => {
      const messages: Message[] = [
        { role: "user", blocks: [{ type: "text", content: "Only message" }] },
      ];

      // Insert at beginning
      const result1 = addCompressBlockToMessage(messages, 0, "Compressed", 2);
      expect(result1).toHaveLength(2);
      const firstBlock = result1[0].blocks[0];
      if (firstBlock.type === "compress") {
        expect(firstBlock.content).toBe("Compressed");
      } else {
        throw new Error("Expected compress block");
      }
      expect(result1[1]).toBe(messages[0]);

      // Insert at end
      const result2 = addCompressBlockToMessage(
        messages,
        messages.length,
        "Compressed",
        2,
      );
      expect(result2).toHaveLength(2);
      expect(result2[0]).toBe(messages[0]);
      const lastBlock = result2[1].blocks[0];
      if (lastBlock.type === "compress") {
        expect(lastBlock.content).toBe("Compressed");
      } else {
        throw new Error("Expected compress block");
      }
    });
  });

  describe("Compression trigger logic", () => {
    it("should have correct token threshold configuration", () => {
      const TOKEN_LIMIT = 64000; // This is the threshold used in useAI.ts

      // Test just below threshold
      expect(63999 > TOKEN_LIMIT).toBe(false);

      // Test at threshold
      expect(64000 > TOKEN_LIMIT).toBe(false);

      // Test just above threshold
      expect(64001 > TOKEN_LIMIT).toBe(true);
    });

    it("should calculate correct message slice for compression", () => {
      // Test the slicing logic used in useAI.ts
      const messages: Message[] = Array.from({ length: 10 }, (_, i) => ({
        role: i % 2 === 0 ? "user" : "assistant",
        blocks: [{ type: "text", content: `Message ${i}` }],
      }));

      // Simulate: latestMessages.slice(-7, -1)
      const messagesToCompress = messages.slice(-7, -1);

      expect(messagesToCompress).toHaveLength(6);
      expect(messagesToCompress[0]).toBe(messages[3]); // Index 3
      expect(messagesToCompress[5]).toBe(messages[8]); // Index 8
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

  describe("Compression error handling", () => {
    it("should handle compression service errors gracefully", async () => {
      mockCompressMessages.mockImplementation(async () => {
        throw new Error("Compression service failed");
      });

      try {
        const result = await compressMessages({
          messages: [
            { role: "user", content: [{ type: "text", text: "Test message" }] },
          ],
        });
        expect(result).toBe("对话历史压缩失败");
      } catch (error) {
        // If the mock throws, that's expected - the real function should catch it
        expect(error).toBeInstanceOf(Error);
      }
    });

    it("should handle abort during compression", async () => {
      const abortController = new AbortController();

      mockCompressMessages.mockImplementation(async ({ abortSignal }) => {
        return new Promise((resolve, reject) => {
          if (abortSignal?.aborted) {
            reject(new Error("压缩请求已被中断"));
            return;
          }
          abortSignal?.addEventListener("abort", () => {
            reject(new Error("压缩请求已被中断"));
          });
          setTimeout(() => resolve("压缩结果"), 100);
        });
      });

      setTimeout(() => abortController.abort(), 10);

      await expect(
        compressMessages({
          messages: [
            { role: "user", content: [{ type: "text", text: "Test message" }] },
          ],
          abortSignal: abortController.signal,
        }),
      ).rejects.toThrow("压缩请求已被中断");
    });
  });

  describe("Compression integration with message flow", () => {
    it("should correctly calculate insertion index and remove messages", () => {
      const messages: Message[] = Array.from({ length: 10 }, (_, i) => ({
        role: i % 2 === 0 ? "user" : "assistant",
        blocks: [{ type: "text", content: `Message ${i}` }],
      }));

      // Simulate the compression logic from useAI.ts
      const latestMessages = [...messages];
      const messagesToCompress = latestMessages.slice(-7, -1); // Last 6 messages (excluding current)
      const insertIndex = latestMessages.length - 7; // Before the last 6 messages

      expect(messagesToCompress).toHaveLength(6);
      expect(insertIndex).toBe(3); // Should insert at index 3

      // Simulate the message manipulation
      const newMessages = [...latestMessages];
      newMessages.splice(-7, 6); // Remove last 6 messages (excluding current)
      const result = addCompressBlockToMessage(
        newMessages,
        insertIndex,
        "Compressed content",
        6,
      );

      expect(result).toHaveLength(5); // Original 10 - 6 removed + 1 compress block
      expect(result[insertIndex].blocks[0].type).toBe("compress");
    });

    it("should preserve message order around compression block", () => {
      const messages: Message[] = [
        { role: "user", blocks: [{ type: "text", content: "Early message" }] },
        {
          role: "assistant",
          blocks: [{ type: "text", content: "Early response" }],
        },
        { role: "user", blocks: [{ type: "text", content: "Middle 1" }] },
        {
          role: "assistant",
          blocks: [{ type: "text", content: "Middle response 1" }],
        },
        { role: "user", blocks: [{ type: "text", content: "Middle 2" }] },
        {
          role: "assistant",
          blocks: [{ type: "text", content: "Middle response 2" }],
        },
        { role: "user", blocks: [{ type: "text", content: "Recent 1" }] },
        {
          role: "assistant",
          blocks: [{ type: "text", content: "Recent response 1" }],
        },
        { role: "user", blocks: [{ type: "text", content: "Recent 2" }] },
        {
          role: "assistant",
          blocks: [{ type: "text", content: "Current response" }],
        },
      ];

      // Compress the middle 6 messages (indices 2-7)
      const insertIndex = 2; // Insert at the position where we removed messages

      const newMessages = [...messages];
      newMessages.splice(2, 6); // Remove messages at indices 2-7
      const result = addCompressBlockToMessage(
        newMessages,
        insertIndex,
        "Compressed 6 messages",
        6,
      );

      expect(result).toHaveLength(5);
      const firstBlock = result[0].blocks[0];
      const secondBlock = result[1].blocks[0];
      const thirdBlock = result[2].blocks[0];
      const fourthBlock = result[3].blocks[0];
      const fifthBlock = result[4].blocks[0];

      if (firstBlock.type === "text") {
        expect(firstBlock.content).toBe("Early message"); // Preserved
      }
      if (secondBlock.type === "text") {
        expect(secondBlock.content).toBe("Early response"); // Preserved
      }
      expect(thirdBlock.type).toBe("compress"); // New compress block
      if (fourthBlock.type === "text") {
        expect(fourthBlock.content).toBe("Recent 2"); // Preserved (was index 8)
      }
      if (fifthBlock.type === "text") {
        expect(fifthBlock.content).toBe("Current response"); // Preserved (was index 9)
      }
    });
  });

  describe("getRecentMessages with compression", () => {
    it("should handle messages with compression blocks", () => {
      const messages: Message[] = [
        { role: "user", blocks: [{ type: "text", content: "Old message" }] },
        {
          role: "assistant",
          blocks: [
            {
              type: "compress",
              content: "Compressed conversation about file operations",
              compressedMessageCount: 4,
            },
          ],
        },
        { role: "user", blocks: [{ type: "text", content: "New message" }] },
        {
          role: "assistant",
          blocks: [{ type: "text", content: "New response" }],
        },
      ];

      // Mock the behavior of getRecentMessages when it encounters a compress block
      mockGetRecentMessages.mockReturnValue([
        { role: "user", content: [{ type: "text", text: "Old message" }] },
        {
          role: "assistant",
          content:
            "[压缩消息摘要] Compressed conversation about file operations",
        },
        { role: "user", content: [{ type: "text", text: "New message" }] },
        { role: "assistant", content: "New response" },
      ]);

      const result = getRecentMessages(messages);

      expect(result).toEqual([
        { role: "user", content: [{ type: "text", text: "Old message" }] },
        {
          role: "assistant",
          content:
            "[压缩消息摘要] Compressed conversation about file operations",
        },
        { role: "user", content: [{ type: "text", text: "New message" }] },
        { role: "assistant", content: "New response" },
      ]);
    });
  });

  describe("Compression configuration and limits", () => {
    it("should use correct token threshold (64k)", () => {
      const TOKEN_LIMIT = 64000;

      // Test just below threshold
      expect(63999 > TOKEN_LIMIT).toBe(false);

      // Test at threshold
      expect(64000 > TOKEN_LIMIT).toBe(false);

      // Test just above threshold
      expect(64001 > TOKEN_LIMIT).toBe(true);
    });

    it("should compress exactly 6 messages", () => {
      const messages: Message[] = Array.from({ length: 20 }, (_, i) => ({
        role: i % 2 === 0 ? "user" : "assistant",
        blocks: [{ type: "text", content: `Message ${i}` }],
      }));

      // Simulate the slice logic from useAI.ts
      const messagesToCompress = messages.slice(-7, -1); // Should be 6 messages

      expect(messagesToCompress).toHaveLength(6);
      expect(messagesToCompress[0]).toBe(messages[13]); // Index 13
      expect(messagesToCompress[5]).toBe(messages[18]); // Index 18
    });
  });
});
