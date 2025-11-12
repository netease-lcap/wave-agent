import { describe, it, expect } from "vitest";
import { updateToolBlockInMessage } from "@/utils/messageOperations.js";
import { convertMessagesForAPI } from "@/utils/convertMessagesForAPI.js";
import type { Message } from "@/types/index.js";

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
            id: "tool-123",
            name: "screenshot_tool",
            isRunning: false,
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

    const updatedMessages = updateToolBlockInMessage({
      messages,
      id: "tool-123",
      parameters: '{"action": "screenshot"}',
      result: "Screenshot captured successfully",
      success: true,
      error: undefined,
      isRunning: false,
      name: "screenshot_tool",
      shortResult: "Screenshot taken",
      images: mockImages,
    });

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
            id: "tool-123",
            name: "screenshot_tool",
            isRunning: false,
          },
        ],
      },
    ];

    const apiMessages = convertMessagesForAPI(messages);

    // Should generate two messages: assistant message (tool calls) + user message (tool result with images)
    expect(apiMessages).toHaveLength(2);

    // First should be assistant message containing tool calls
    expect(apiMessages[0].role).toBe("assistant");
    expect(apiMessages[0]).toHaveProperty("tool_calls");
    if ("tool_calls" in apiMessages[0] && apiMessages[0].tool_calls) {
      expect(apiMessages[0].tool_calls).toHaveLength(1);
      const toolCall = apiMessages[0].tool_calls[0];
      if ("function" in toolCall) {
        expect(toolCall.function.name).toBe("screenshot_tool");
      }
    }

    // Second should be user message containing tool results and images
    expect(apiMessages[1].role).toBe("user");

    // Check content structure
    const content = apiMessages[1].content;
    expect(Array.isArray(content)).toBe(true);

    if (Array.isArray(content)) {
      // Should contain text and images
      expect(content).toHaveLength(2);

      // First part should be text
      expect(content[0].type).toBe("text");
      expect(content[0]).toHaveProperty("text");
      if (content[0].type === "text") {
        expect(content[0].text).toContain("screenshot_tool");
        expect(content[0].text).toContain("Screenshot captured successfully");
      }

      // Second part should be image
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
            id: "tool-456",
            name: "read_file",
            isRunning: false,
          },
        ],
      },
    ];

    const apiMessages = convertMessagesForAPI(messages);

    // Should generate two messages: assistant message + tool message
    expect(apiMessages).toHaveLength(2);

    // First should be assistant message
    expect(apiMessages[0].role).toBe("assistant");
    expect(apiMessages[0]).toHaveProperty("tool_calls");

    // Second should be tool message (not user message, because no images)
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
            id: "tool-789",
            name: "multi_screenshot",
            isRunning: false,
          },
        ],
      },
    ];

    const apiMessages = convertMessagesForAPI(messages);

    // Should generate two messages: assistant message + user message with images
    expect(apiMessages).toHaveLength(2);

    // First should be assistant message
    expect(apiMessages[0].role).toBe("assistant");
    expect(apiMessages[0]).toHaveProperty("tool_calls");

    // Second should be user message containing images
    expect(apiMessages[1].role).toBe("user");

    const content = apiMessages[1].content;
    if (Array.isArray(content)) {
      // Should contain 1 text + 2 images = 3 content parts
      expect(content).toHaveLength(3);

      expect(content[0].type).toBe("text");
      expect(content[1].type).toBe("image_url");
      expect(content[2].type).toBe("image_url");

      // Check image URL format
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
