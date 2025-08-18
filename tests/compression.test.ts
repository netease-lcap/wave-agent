import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { compressMessages } from "@/services/aiService";
import { addCompressBlockToMessage } from "@/utils/messageOperations";
import { convertMessagesForAPI } from "@/utils/convertMessagesForAPI";
import type { Message } from "@/types";
import type { ChatCompletionMessageParam } from "@/types/common";

// Mock dependencies
vi.mock("@/services/aiService");
vi.mock("@/utils/convertMessagesForAPI");
vi.mock("@/utils/logger");
vi.mock("@/contexts/useFiles", () => ({
  useFiles: () => ({
    workdir: "/test/workdir",
    setFlatFiles: vi.fn(),
    flatFiles: [],
  }),
}));

const mockCompressMessages = vi.mocked(compressMessages);
const mockConvertMessagesForAPI = vi.mocked(convertMessagesForAPI);

describe("Message Compression Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
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
      const insertIndex = 2;

      const result = addCompressBlockToMessage(
        messages,
        insertIndex,
        compressContent,
      );

      expect(result).toHaveLength(5); // 原来4条 + 新增1条
      expect(result[insertIndex].role).toBe("assistant");
      expect(result[insertIndex].blocks).toHaveLength(1);

      const compressBlock = result[insertIndex].blocks[0];
      if (compressBlock.type === "compress") {
        expect(compressBlock.content).toBe(compressContent);
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
      const resultBeginning = addCompressBlockToMessage(
        messages,
        0,
        "Compressed content",
      );

      expect(resultBeginning).toHaveLength(2);
      expect(resultBeginning[0].blocks[0].type).toBe("compress");
      expect(resultBeginning[1]).toBe(messages[0]);

      // Insert at end
      const resultEnd = addCompressBlockToMessage(
        messages,
        1,
        "Compressed content",
      );

      expect(resultEnd).toHaveLength(2);
      expect(resultEnd[0]).toBe(messages[0]);
      expect(resultEnd[1].blocks[0].type).toBe("compress");
    });

    it("should create proper compress block structure", () => {
      const messages: Message[] = [
        { role: "user", blocks: [{ type: "text", content: "Test" }] },
      ];

      const result = addCompressBlockToMessage(
        messages,
        0,
        "Test compression content",
      );

      const compressMessage = result[0];
      expect(compressMessage.role).toBe("assistant");
      expect(compressMessage.blocks).toHaveLength(1);

      const compressBlock = compressMessage.blocks[0];
      if (compressBlock.type === "compress") {
        expect(compressBlock.content).toBe("Test compression content");
      } else {
        throw new Error("Expected compress block");
      }
    });
  });

  describe("Compression trigger logic", () => {
    it("should only compress when message count exceeds threshold", () => {
      // This is a conceptual test - the actual trigger logic is in aiManager
      // We're testing the helper functions that support compression

      const shortMessageList: Message[] = [
        { role: "user", blocks: [{ type: "text", content: "Short convo" }] },
        {
          role: "assistant",
          blocks: [{ type: "text", content: "Short response" }],
        },
      ];

      const longMessageList: Message[] = Array.from({ length: 10 }, (_, i) => ({
        role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
        blocks: [{ type: "text" as const, content: `Message ${i}` }],
      }));

      // Short conversations shouldn't need compression helpers
      expect(shortMessageList.length).toBeLessThan(6);

      // Long conversations have enough messages for compression
      expect(longMessageList.length).toBeGreaterThan(6);

      // Test that compress block can be added to long conversations
      const compressed = addCompressBlockToMessage(
        longMessageList,
        5,
        "Compressed previous messages",
      );

      expect(compressed.length).toBe(longMessageList.length + 1);
      expect(compressed[5].blocks[0].type).toBe("compress");
    });
  });

  describe("Message format conversion", () => {
    it("should handle convertMessagesForAPI mock", () => {
      const testMessages: Message[] = [
        { role: "user", blocks: [{ type: "text", content: "Test" }] },
      ];

      const expectedAPIFormat: ChatCompletionMessageParam[] = [
        {
          role: "user",
          content: [{ type: "text", text: "Test" }],
        },
      ];

      mockConvertMessagesForAPI.mockReturnValue(expectedAPIFormat);

      const result = convertMessagesForAPI(testMessages);

      expect(result).toEqual(expectedAPIFormat);
      expect(mockConvertMessagesForAPI).toHaveBeenCalledWith(testMessages);
    });
  });

  describe("Integration scenarios", () => {
    it("should simulate full compression workflow", async () => {
      // Simulate a workflow where messages are converted, compressed, and added back
      const originalMessages: Message[] = [
        { role: "user", blocks: [{ type: "text", content: "Create file" }] },
        {
          role: "assistant",
          blocks: [{ type: "text", content: "Creating file..." }],
        },
        { role: "user", blocks: [{ type: "text", content: "Add tests" }] },
        {
          role: "assistant",
          blocks: [{ type: "text", content: "Adding tests..." }],
        },
        { role: "user", blocks: [{ type: "text", content: "Deploy app" }] },
        {
          role: "assistant",
          blocks: [{ type: "text", content: "Deploying..." }],
        },
      ];

      const apiMessages: ChatCompletionMessageParam[] = [
        { role: "user", content: [{ type: "text", text: "Create file" }] },
        { role: "assistant", content: "Creating file..." },
        { role: "user", content: [{ type: "text", text: "Add tests" }] },
        { role: "assistant", content: "Adding tests..." },
        { role: "user", content: [{ type: "text", text: "Deploy app" }] },
        { role: "assistant", content: "Deploying..." },
      ];

      mockConvertMessagesForAPI.mockReturnValue(apiMessages);
      mockCompressMessages.mockResolvedValue(
        "用户依次请求创建文件、添加测试、部署应用，助手逐步完成各项任务",
      );

      // Step 1: Convert messages for API
      const convertedMessages = convertMessagesForAPI(originalMessages);
      expect(convertedMessages).toEqual(apiMessages);

      // Step 2: Compress messages
      const compressedContent = await compressMessages({
        messages: convertedMessages,
      });
      expect(compressedContent).toBe(
        "用户依次请求创建文件、添加测试、部署应用，助手逐步完成各项任务",
      );

      // Step 3: Replace some messages with compress block
      const finalMessages = addCompressBlockToMessage(
        originalMessages.slice(2), // Keep last 4 messages
        0, // Insert at beginning
        compressedContent,
      );

      expect(finalMessages).toHaveLength(5); // 4 remaining + 1 compress block
      expect(finalMessages[0].blocks[0].type).toBe("compress");
      expect(finalMessages[0].blocks[0]).toHaveProperty(
        "content",
        compressedContent,
      );
    });
  });
});
