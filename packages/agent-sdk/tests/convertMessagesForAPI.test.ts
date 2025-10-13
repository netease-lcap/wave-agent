import { describe, it, expect } from "vitest";
import { convertMessagesForAPI } from "../src/utils/convertMessagesForAPI.js";
import type { Message } from "../src/types.js";

describe("convertMessagesForAPI with subAgent", () => {
  it("should skip subAgent messages and not include them in API request", () => {
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
        role: "subAgent",
        blocks: [
          { type: "text", content: "Executed custom command: /refactor" },
        ],
        messages: [
          {
            role: "user",
            blocks: [{ type: "text", content: "Refactor this code..." }],
          },
          {
            role: "assistant",
            blocks: [
              { type: "text", content: "Here's the refactored code..." },
            ],
          },
        ],
      },
      {
        role: "user",
        blocks: [
          { type: "text", content: "Thanks! Can you do something else?" },
        ],
      },
    ];

    const apiMessages = convertMessagesForAPI(messages);

    // Should only include the main conversation messages, not the subAgent messages
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

    // Verify subAgent messages are filtered out (they should not appear in the API messages)
    // The test above confirms we only have 3 messages instead of 4 (subAgent message was filtered)

    // Verify no sub-conversation messages made it through
    expect(
      apiMessages.some(
        (msg) =>
          Array.isArray(msg.content) &&
          msg.content.some(
            (part) =>
              part.type === "text" &&
              (part.text.includes("Refactor this code") ||
                part.text.includes("refactored code")),
          ),
      ),
    ).toBe(false);
  });

  it("should handle messages with only subAgent messages", () => {
    const messages: Message[] = [
      {
        role: "subAgent",
        blocks: [
          { type: "text", content: "Executed custom command: /security-check" },
        ],
        messages: [
          {
            role: "user",
            blocks: [{ type: "text", content: "Check for security issues..." }],
          },
          {
            role: "assistant",
            blocks: [{ type: "text", content: "Found these issues..." }],
          },
        ],
      },
    ];

    const apiMessages = convertMessagesForAPI(messages);

    // Should return empty array since there are no main conversation messages
    expect(apiMessages).toHaveLength(0);
  });

  it("should handle mixed messages correctly", () => {
    const messages: Message[] = [
      {
        role: "user",
        blocks: [{ type: "text", content: "Initial question" }],
      },
      {
        role: "subAgent",
        blocks: [{ type: "text", content: "Executed custom command: /test" }],
        messages: [
          {
            role: "user",
            blocks: [{ type: "text", content: "Sub conversation" }],
          },
        ],
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
