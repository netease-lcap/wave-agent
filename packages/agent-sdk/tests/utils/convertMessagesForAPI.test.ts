import { describe, it, expect } from "vitest";
import { convertMessagesForAPI } from "../../src/utils/convertMessagesForAPI.js";
import type { Message } from "../../src/types/index.js";
import type {
  ChatCompletionAssistantMessageParam,
  ChatCompletionMessageFunctionToolCall,
  ChatCompletionMessageParam,
} from "openai/resources.js";

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

  it("should convert text blocks with customCommandContent for API", () => {
    const messages: Message[] = [
      {
        role: "user",
        blocks: [
          {
            type: "text",
            content: "/refactor",
            customCommandContent:
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

  it("should filter out messages with no meaningful content or tool calls", () => {
    const messages: Message[] = [
      {
        role: "user",
        blocks: [{ type: "text", content: "Hello, can you help me?" }],
      },
      {
        role: "assistant",
        blocks: [{ type: "text", content: "" }], // Empty content
      },
      {
        role: "assistant",
        blocks: [{ type: "text", content: "   " }], // Whitespace only
      },
      {
        role: "assistant",
        blocks: [], // No blocks at all
      },
      {
        role: "user",
        blocks: [{ type: "text", content: "" }], // Empty user message
      },
      {
        role: "user",
        blocks: [{ type: "text", content: "   " }], // Whitespace only user message
      },
      {
        role: "assistant",
        blocks: [{ type: "text", content: "This is a valid response" }],
      },
    ];

    const apiMessages = convertMessagesForAPI(messages);

    // Should only have the initial user message and the final assistant message
    expect(apiMessages).toHaveLength(2);

    expect(apiMessages[0].role).toBe("user");
    expect(apiMessages[0].content).toEqual([
      { type: "text", text: "Hello, can you help me?" },
    ]);

    expect(apiMessages[1].role).toBe("assistant");
    expect(apiMessages[1].content).toBe("This is a valid response");
  });

  it("should handle assistant messages with valid tool calls but no text content", () => {
    const messages: Message[] = [
      {
        role: "user",
        blocks: [{ type: "text", content: "Run a tool for me" }],
      },
      {
        role: "assistant",
        blocks: [
          {
            type: "tool",
            id: "tool1",
            name: "bash",
            parameters: '{"command": "echo hello"}',
            stage: "end",
            result: "hello",
            success: true,
          },
        ],
      },
    ];

    const apiMessages = convertMessagesForAPI(messages);

    // Should include user message, assistant message with tool calls, and tool result
    expect(apiMessages).toHaveLength(3);

    expect(apiMessages[0].role).toBe("user");
    expect(apiMessages[1].role).toBe("assistant");
    // Type assertion for assistant message with tool_calls
    const assistantMessage = apiMessages[1] as ChatCompletionMessageParam & {
      tool_calls?: ChatCompletionMessageFunctionToolCall[];
    };
    expect(assistantMessage.tool_calls).toBeDefined();
    expect(assistantMessage.tool_calls).toHaveLength(1);
    // Content should be undefined when there's no text content, only tool calls
    expect(apiMessages[1].content).toBeUndefined();

    expect(apiMessages[2].role).toBe("tool");
    expect(apiMessages[2].content).toBe("hello");
  });

  it("should filter out ErrorBlock content to ensure user-visible only (FR-020)", () => {
    // FR-020: System MUST ensure ErrorBlock content is not processed by
    // convertMessagesForAPI so it remains user-visible only and is not sent to the agent
    const messages: Message[] = [
      {
        role: "user",
        blocks: [{ type: "text", content: "Test prompt" }],
      },
      {
        role: "assistant",
        blocks: [
          { type: "error", content: "This error should NOT be sent to API" },
          { type: "text", content: "This response should be sent to API" },
        ],
      },
    ];

    const apiMessages = convertMessagesForAPI(messages);

    expect(apiMessages).toHaveLength(2);

    // User message should be included
    expect(apiMessages[0].role).toBe("user");
    expect(apiMessages[0].content).toEqual([
      { type: "text", text: "Test prompt" },
    ]);

    // Assistant message should only include text content, NOT error content
    expect(apiMessages[1].role).toBe("assistant");
    expect(apiMessages[1].content).toBe("This response should be sent to API");

    // FR-020: Verify ErrorBlock content is completely excluded from API messages
    const allApiContent = JSON.stringify(apiMessages);
    expect(allApiContent).not.toContain("This error should NOT be sent to API");
  });

  it("should include reasoning content in assistant messages for API", () => {
    const messages: Message[] = [
      {
        role: "user",
        blocks: [{ type: "text", content: "What is 2+2?" }],
      },
      {
        role: "assistant",
        blocks: [
          {
            type: "reasoning",
            content: "Let me think about this...",
          },
          { type: "text", content: "The answer is 4." },
        ],
      },
    ];

    const apiMessages = convertMessagesForAPI(messages);

    expect(apiMessages).toHaveLength(2);

    expect(apiMessages[0].role).toBe("user");
    expect(apiMessages[0].content).toEqual([
      { type: "text", text: "What is 2+2?" },
    ]);

    expect(apiMessages[1].role).toBe("assistant");
    const assistantMessage = apiMessages[1] as ChatCompletionMessageParam & {
      reasoning_content?: string;
    };
    expect(assistantMessage.content).toBe("The answer is 4.");
    expect(assistantMessage.reasoning_content).toBe(
      "Let me think about this...",
    );
  });

  it("should join multiple reasoning blocks in assistant messages", () => {
    const messages: Message[] = [
      {
        role: "user",
        blocks: [{ type: "text", content: "Explain quantum computing" }],
      },
      {
        role: "assistant",
        blocks: [
          {
            type: "reasoning",
            content: "First, define qubits.",
          },
          { type: "text", content: "Quantum computing uses qubits." },
          {
            type: "reasoning",
            content: "Then explain superposition.",
          },
        ],
      },
    ];

    const apiMessages = convertMessagesForAPI(messages);

    expect(apiMessages).toHaveLength(2);

    const assistantMessage = apiMessages[1] as ChatCompletionMessageParam & {
      reasoning_content?: string;
    };
    expect(assistantMessage.reasoning_content).toBe(
      "First, define qubits.\nThen explain superposition.",
    );
  });

  it("should not include reasoning_content when there are no reasoning blocks", () => {
    const messages: Message[] = [
      {
        role: "user",
        blocks: [{ type: "text", content: "Hello" }],
      },
      {
        role: "assistant",
        blocks: [{ type: "text", content: "Hi there!" }],
      },
    ];

    const apiMessages = convertMessagesForAPI(messages);

    expect(apiMessages).toHaveLength(2);
    const assistantMessage = apiMessages[1] as ChatCompletionMessageParam & {
      reasoning_content?: string;
    };
    expect(assistantMessage.reasoning_content).toBeUndefined();
  });

  it("should preserve thought_signature on tool_calls for Gemini multi-turn tool calling", () => {
    const messages: Message[] = [
      {
        role: "user",
        blocks: [{ type: "text", content: "Read a file" }],
      },
      {
        role: "assistant",
        blocks: [
          {
            type: "tool",
            id: "call_read_1",
            name: "default_api:Read",
            parameters: '{"path": "/tmp/foo.txt"}',
            stage: "end",
            result: "file contents",
            success: true,
            toolCallMetadata: {
              thought_signature: "encrypted-signature-abc",
            },
          },
        ],
      },
    ];

    const apiMessages = convertMessagesForAPI(messages);
    const assistantMessage = apiMessages[1] as ChatCompletionMessageParam & {
      tool_calls?: Array<Record<string, unknown>>;
      thought_signature?: string;
    };

    expect(assistantMessage.tool_calls).toHaveLength(1);
    const toolCall = assistantMessage
      .tool_calls?.[0] as ChatCompletionMessageFunctionToolCall & {
      thought_signature?: string;
    };
    expect(toolCall.function.name).toBe("Read");
    expect(toolCall.thought_signature).toBe("encrypted-signature-abc");
    expect(assistantMessage.thought_signature).toBeUndefined();
  });

  it("should omit tool_calls for blocks with unknown placeholder names", () => {
    const messages: Message[] = [
      {
        role: "user",
        blocks: [{ type: "text", content: "Do something" }],
      },
      {
        role: "assistant",
        blocks: [
          {
            type: "tool",
            id: "call_bad",
            name: "unknown",
            parameters: "{}",
            stage: "end",
            result: "Error: Tool 'unknown' not found",
            success: false,
          },
        ],
      },
    ];

    const apiMessages = convertMessagesForAPI(messages);
    const assistantMessage =
      apiMessages[1] as ChatCompletionAssistantMessageParam;
    expect(assistantMessage.tool_calls).toBeUndefined();
  });

  it("should move thought_signature from additionalFields to first tool_call", () => {
    const messages: Message[] = [
      {
        role: "user",
        blocks: [{ type: "text", content: "Read a file" }],
      },
      {
        role: "assistant",
        additionalFields: {
          thought_signature: "sig-from-message-level",
          forgetDistance: 1,
        },
        blocks: [
          {
            type: "tool",
            id: "call_read_1",
            name: "Read",
            parameters: "{}",
            stage: "end",
            result: "ok",
            success: true,
          },
        ],
      },
    ];

    const apiMessages = convertMessagesForAPI(messages);
    const assistantMessage = apiMessages[1] as ChatCompletionMessageParam & {
      tool_calls?: Array<Record<string, unknown>>;
      thought_signature?: string;
      forgetDistance?: number;
    };

    expect(assistantMessage.tool_calls?.[0].thought_signature).toBe(
      "sig-from-message-level",
    );
    expect(assistantMessage.thought_signature).toBeUndefined();
    expect(assistantMessage.forgetDistance).toBe(1);
  });
});
