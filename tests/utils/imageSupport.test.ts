import { describe, it, expect } from "vitest";
import { updateToolBlockInMessage } from "@/utils/messageOperations.js";
import { convertMessagesForAPI } from "@/utils/convertMessagesForAPI.js";
import type { Message } from "@/types.js";

describe("Image Support in Tool Results", () => {
  it("should handle tool result with images in updateToolBlockInMessage", () => {
    const messages: Message[] = [
      {
        role: "assistant",
        blocks: [
          {
            type: "tool",
            parameters: '{"action": "screenshot"}',
            result: "",
            attributes: {
              id: "tool-123",
              name: "screenshot_tool",
              isStreaming: false,
              isRunning: false,
            },
          },
        ],
      },
    ];

    const mockImages = [
      {
        data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChAI9jU77vwAAAABJRU5ErkJggg==",
        mediaType: "image/png",
      },
    ];

    const updatedMessages = updateToolBlockInMessage(
      messages,
      "tool-123",
      '{"action": "screenshot"}',
      "Screenshot captured successfully",
      true,
      undefined,
      false,
      false,
      "screenshot_tool",
      "Screenshot taken",
      mockImages,
    );

    const toolBlock = updatedMessages[0].blocks[0];

    expect(toolBlock.type).toBe("tool");
    if (toolBlock.type === "tool") {
      expect(toolBlock.images).toBeDefined();
      expect(toolBlock.images).toHaveLength(1);
      expect(toolBlock.images![0].data).toBe(mockImages[0].data);
      expect(toolBlock.images![0].mediaType).toBe("image/png");
      expect(toolBlock.result).toBe("Screenshot captured successfully");
    }
  });

  it("should convert tool block with images to user message in convertMessagesForAPI", () => {
    const messages: Message[] = [
      {
        role: "assistant",
        blocks: [
          {
            type: "tool",
            parameters: '{"action": "screenshot"}',
            result: "Screenshot captured successfully",
            images: [
              {
                data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChAI9jU77vwAAAABJRU5ErkJggg==",
                mediaType: "image/png",
              },
            ],
            attributes: {
              id: "tool-123",
              name: "screenshot_tool",
              isStreaming: false,
              isRunning: false,
            },
          },
        ],
      },
    ];

    const apiMessages = convertMessagesForAPI(messages);

    // 应该生成两条消息：assistant message (tool calls) + user message (tool result with images)
    expect(apiMessages).toHaveLength(2);

    // 第一条应该是 assistant 消息包含工具调用
    expect(apiMessages[0].role).toBe("assistant");
    expect(apiMessages[0]).toHaveProperty("tool_calls");
    if ("tool_calls" in apiMessages[0] && apiMessages[0].tool_calls) {
      expect(apiMessages[0].tool_calls).toHaveLength(1);
      const toolCall = apiMessages[0].tool_calls[0];
      if ("function" in toolCall) {
        expect(toolCall.function.name).toBe("screenshot_tool");
      }
    }

    // 第二条应该是 user 消息包含工具结果和图片
    expect(apiMessages[1].role).toBe("user");

    // 检查内容结构
    const content = apiMessages[1].content;
    expect(Array.isArray(content)).toBe(true);

    if (Array.isArray(content)) {
      // 应该包含文本和图片
      expect(content).toHaveLength(2);

      // 第一部分应该是文本
      expect(content[0].type).toBe("text");
      expect(content[0]).toHaveProperty("text");
      if (content[0].type === "text") {
        expect(content[0].text).toContain("screenshot_tool");
        expect(content[0].text).toContain("Screenshot captured successfully");
      }

      // 第二部分应该是图片
      expect(content[1].type).toBe("image_url");
      expect(content[1]).toHaveProperty("image_url");
      if (content[1].type === "image_url") {
        expect(content[1].image_url.url).toContain("data:image/png;base64,");
      }
    }
  });

  it("should handle tool block without images normally", () => {
    const messages: Message[] = [
      {
        role: "assistant",
        blocks: [
          {
            type: "tool",
            parameters: '{"file": "test.txt"}',
            result: "File content here",
            attributes: {
              id: "tool-456",
              name: "read_file",
              isStreaming: false,
              isRunning: false,
            },
          },
        ],
      },
    ];

    const apiMessages = convertMessagesForAPI(messages);

    // 应该生成两条消息：assistant message + tool message
    expect(apiMessages).toHaveLength(2);

    // 第一条应该是 assistant 消息
    expect(apiMessages[0].role).toBe("assistant");
    expect(apiMessages[0]).toHaveProperty("tool_calls");

    // 第二条应该是工具消息（不是用户消息，因为没有图片）
    expect(apiMessages[1].role).toBe("tool");
    expect(apiMessages[1]).toHaveProperty("tool_call_id", "tool-456");
    expect(apiMessages[1].content).toBe("File content here");
  });

  it("should handle multiple images in tool result", () => {
    const messages: Message[] = [
      {
        role: "assistant",
        blocks: [
          {
            type: "tool",
            parameters: '{"action": "multi_screenshot"}',
            result: "Multiple screenshots captured",
            images: [
              {
                data: "image1_base64_data",
                mediaType: "image/png",
              },
              {
                data: "image2_base64_data",
                mediaType: "image/jpeg",
              },
            ],
            attributes: {
              id: "tool-789",
              name: "multi_screenshot",
              isStreaming: false,
              isRunning: false,
            },
          },
        ],
      },
    ];

    const apiMessages = convertMessagesForAPI(messages);

    // 应该生成两条消息：assistant message + user message with images
    expect(apiMessages).toHaveLength(2);

    // 第一条应该是 assistant 消息
    expect(apiMessages[0].role).toBe("assistant");
    expect(apiMessages[0]).toHaveProperty("tool_calls");

    // 第二条应该是用户消息包含图片
    expect(apiMessages[1].role).toBe("user");

    const content = apiMessages[1].content;
    if (Array.isArray(content)) {
      // 应该包含1个文本 + 2个图片 = 3个内容部分
      expect(content).toHaveLength(3);

      expect(content[0].type).toBe("text");
      expect(content[1].type).toBe("image_url");
      expect(content[2].type).toBe("image_url");

      // 检查图片URL格式
      if (content[1].type === "image_url") {
        expect(content[1].image_url.url).toContain(
          "data:image/png;base64,image1_base64_data",
        );
      }
      if (content[2].type === "image_url") {
        expect(content[2].image_url.url).toContain(
          "data:image/jpeg;base64,image2_base64_data",
        );
      }
    }
  });
});
