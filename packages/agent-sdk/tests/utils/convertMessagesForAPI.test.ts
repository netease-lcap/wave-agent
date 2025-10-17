import { describe, it, expect } from "vitest";
import { convertMessagesForAPI } from "../../src/utils/convertMessagesForAPI.js";
import type { Message } from "../../src/types.js";

describe("convertMessagesForAPI", () => {
  it("should correctly convert user and assistant messages", () => {
    const messages: Message[] = [
      {
        role: "user",
        blocks: [{ type: "text", content: "Hello, can you help me?" }],
      },
      {
        role: "assistant",
        blocks: [{ type: "text", content: "Sure! How can I help you?" }],
      },
      {
        role: "user",
        blocks: [
          { type: "text", content: "Thanks! Can you do something else?" },
        ],
      },
    ];

    const apiMessages = convertMessagesForAPI(messages);

    expect(apiMessages).toHaveLength(3);

    // Check that we have the correct messages in the right order
    expect(apiMessages[0].role).toBe("user");
    expect(apiMessages[0].content).toEqual([
      { type: "text", text: "Hello, can you help me?" },
    ]);

    expect(apiMessages[1].role).toBe("assistant");
    expect(apiMessages[1].content).toBe("Sure! How can I help you?");

    expect(apiMessages[2].role).toBe("user");
    expect(apiMessages[2].content).toEqual([
      { type: "text", text: "Thanks! Can you do something else?" },
    ]);
  });

  it("should convert custom command blocks to full content for API", () => {
    const messages: Message[] = [
      {
        role: "user",
        blocks: [
          {
            type: "custom_command",
            commandName: "refactor",
            content:
              "Please refactor this function to be more efficient:\n\nfunction oldFunction() {\n  // some code\n}",
          },
        ],
      },
      {
        role: "assistant",
        blocks: [
          { type: "text", content: "I'll help you refactor that function." },
        ],
      },
    ];

    const apiMessages = convertMessagesForAPI(messages);

    expect(apiMessages).toHaveLength(2);

    // Check that custom command content is expanded for API
    expect(apiMessages[0].role).toBe("user");
    expect(apiMessages[0].content).toEqual([
      {
        type: "text",
        text: "Please refactor this function to be more efficient:\n\nfunction oldFunction() {\n  // some code\n}",
      },
    ]);

    expect(apiMessages[1].role).toBe("assistant");
    expect(apiMessages[1].content).toBe(
      "I'll help you refactor that function.",
    );
  });

  it("should handle empty message arrays", () => {
    const messages: Message[] = [];

    const apiMessages = convertMessagesForAPI(messages);

    expect(apiMessages).toHaveLength(0);
  });

  it("should handle messages with multiple blocks", () => {
    const messages: Message[] = [
      {
        role: "user",
        blocks: [{ type: "text", content: "Initial question" }],
      },
      {
        role: "assistant",
        blocks: [{ type: "text", content: "Final response" }],
      },
    ];

    const apiMessages = convertMessagesForAPI(messages);

    expect(apiMessages).toHaveLength(2);
    expect(apiMessages[0].role).toBe("user");
    expect(apiMessages[1].role).toBe("assistant");
    expect(apiMessages[1].content).toBe("Final response");
  });
});
