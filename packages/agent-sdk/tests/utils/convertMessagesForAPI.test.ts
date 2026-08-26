import { describe, it, expect, vi } from "vitest";
import { convertMessagesForAPI } from "../../src/utils/convertMessagesForAPI.js";
import { generateMessageId } from "../../src/utils/messageOperations.js";
import type { Message } from "../../src/types/index.js";
import type {
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
} from "openai/resources.js";

// convertImageToBase64 reads the file from disk; stub it so path-based image
// tests can verify the `[Image source: <path>]` metadata without real files.
vi.mock("../../src/utils/messageOperations.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../src/utils/messageOperations.js")
    >();
  return {
    ...actual,
    convertImageToBase64: vi.fn(
      (imagePath: string) =>
        `data:image/png;base64,${Buffer.from(`mock:${imagePath}`).toString("base64")}`,
    ),
  };
});

describe("convertMessagesForAPI", () => {
  it("should correctly convert user and assistant messages", () => {
    const messages: Message[] = [
      {
        id: generateMessageId(),
        role: "user",
        blocks: [{ type: "text", content: "Hello, can you help me?" }],
        timestamp: new Date().toISOString(),
      },
      {
        id: generateMessageId(),
        role: "assistant",
        blocks: [{ type: "text", content: "Sure! How can I help you?" }],
        timestamp: new Date().toISOString(),
      },
      {
        id: generateMessageId(),
        role: "user",
        blocks: [
          { type: "text", content: "Thanks! Can you do something else?" },
        ],
        timestamp: new Date().toISOString(),
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

  it("should convert user message with text content for API", () => {
    const messages: Message[] = [
      {
        id: generateMessageId(),
        role: "user",
        blocks: [
          {
            type: "text",
            content:
              "Please refactor this function to be more efficient:\n\nfunction oldFunction() {\n  // some code\n}",
          },
        ],
        timestamp: new Date().toISOString(),
      },
      {
        id: generateMessageId(),
        role: "assistant",
        blocks: [
          { type: "text", content: "I'll help you refactor that function." },
        ],
        timestamp: new Date().toISOString(),
      },
    ];

    const apiMessages = convertMessagesForAPI(messages);

    expect(apiMessages).toHaveLength(2);

    // Check that text content is included for API
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

  it("should include tool block result in API conversion", () => {
    const messages: Message[] = [
      {
        id: generateMessageId(),
        role: "user",
        blocks: [
          {
            type: "text",
            content: "/test-fork",
          },
          {
            type: "tool",
            id: "tool-1",
            name: "test-fork",
            parameters: "skill content",
            result: "Subagent result",
            stage: "end",
          },
        ],
        timestamp: new Date().toISOString(),
      },
    ];

    const apiMessages = convertMessagesForAPI(messages);

    expect(apiMessages).toHaveLength(1);
    expect(apiMessages[0].role).toBe("user");
    expect(apiMessages[0].content).toEqual([
      { type: "text", text: "/test-fork" },
      {
        type: "text",
        text: `<local-command-stdout>\nSubagent result\n</local-command-stdout>`,
      },
    ]);
  });

  it("should handle empty message arrays", () => {
    const messages: Message[] = [];

    const apiMessages = convertMessagesForAPI(messages);

    expect(apiMessages).toHaveLength(0);
  });

  it("should handle messages with multiple blocks", () => {
    const messages: Message[] = [
      {
        id: generateMessageId(),
        role: "user",
        blocks: [{ type: "text", content: "Initial question" }],
        timestamp: new Date().toISOString(),
      },
      {
        id: generateMessageId(),
        role: "assistant",
        blocks: [{ type: "text", content: "Final response" }],
        timestamp: new Date().toISOString(),
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
        id: generateMessageId(),
        role: "user",
        blocks: [{ type: "text", content: "Hello, can you help me?" }],
        timestamp: new Date().toISOString(),
      },
      {
        id: generateMessageId(),
        role: "assistant",
        blocks: [{ type: "text", content: "" }], // Empty content,
        timestamp: new Date().toISOString(),
      },
      {
        id: generateMessageId(),
        role: "assistant",
        blocks: [{ type: "text", content: "   " }], // Whitespace only,
        timestamp: new Date().toISOString(),
      },
      {
        id: generateMessageId(),
        role: "assistant",
        blocks: [], // No blocks at all,
        timestamp: new Date().toISOString(),
      },
      {
        id: generateMessageId(),
        role: "user",
        blocks: [{ type: "text", content: "" }], // Empty user message,
        timestamp: new Date().toISOString(),
      },
      {
        id: generateMessageId(),
        role: "user",
        blocks: [{ type: "text", content: "   " }], // Whitespace only user message,
        timestamp: new Date().toISOString(),
      },
      {
        id: generateMessageId(),
        role: "assistant",
        blocks: [{ type: "text", content: "This is a valid response" }],
        timestamp: new Date().toISOString(),
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
        id: generateMessageId(),
        role: "user",
        blocks: [{ type: "text", content: "Run a tool for me" }],
        timestamp: new Date().toISOString(),
      },
      {
        id: generateMessageId(),
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
        timestamp: new Date().toISOString(),
      },
    ];

    const apiMessages = convertMessagesForAPI(messages);

    // Should include user message, assistant message with tool calls, and tool result
    expect(apiMessages).toHaveLength(3);

    expect(apiMessages[0].role).toBe("user");
    expect(apiMessages[1].role).toBe("assistant");
    // Type assertion for assistant message with tool_calls
    const assistantMessage = apiMessages[1] as ChatCompletionMessageParam & {
      tool_calls?: ChatCompletionMessageToolCall[];
    };
    expect(assistantMessage.tool_calls).toBeDefined();
    expect(assistantMessage.tool_calls).toHaveLength(1);
    // Content should be undefined when there's no text content, only tool calls
    expect(apiMessages[1].content).toBeUndefined();

    expect(apiMessages[2].role).toBe("tool");
    expect(apiMessages[2].content).toBe("hello");
  });

  it("should not inject truncation note when assistant message has tool calls but no text content", () => {
    const messages: Message[] = [
      {
        id: generateMessageId(),
        role: "user",
        blocks: [{ type: "text", content: "Run a tool for me" }],
        timestamp: new Date().toISOString(),
      },
      {
        id: generateMessageId(),
        role: "assistant",
        blocks: [
          {
            type: "reasoning",
            content: "I need to call the bash tool to check the directory.",
          },
          {
            type: "tool",
            id: "tool1",
            name: "bash",
            parameters: '{"command": "ls"}',
            stage: "end",
            result: "file.txt",
            success: true,
          },
        ],
        timestamp: new Date().toISOString(),
      },
    ];

    const apiMessages = convertMessagesForAPI(messages);

    expect(apiMessages).toHaveLength(3);

    const assistantMessage = apiMessages[1] as ChatCompletionMessageParam & {
      tool_calls?: ChatCompletionMessageToolCall[];
      reasoning_content?: string;
    };
    // Tool calls make the request valid — the truncation note must not be
    // injected (the turn is not truncated, it produced a tool call).
    expect(assistantMessage.content).toBeUndefined();
    expect(assistantMessage.tool_calls).toHaveLength(1);
    expect(assistantMessage.reasoning_content).toBe(
      "I need to call the bash tool to check the directory.",
    );
  });

  it("should filter out ErrorBlock content to ensure user-visible only (FR-020)", () => {
    // FR-020: System MUST ensure ErrorBlock content is not processed by
    // convertMessagesForAPI so it remains user-visible only and is not sent to the agent
    const messages: Message[] = [
      {
        id: generateMessageId(),
        role: "user",
        blocks: [{ type: "text", content: "Test prompt" }],
        timestamp: new Date().toISOString(),
      },
      {
        id: generateMessageId(),
        role: "assistant",
        blocks: [
          { type: "error", content: "This error should NOT be sent to API" },
          { type: "text", content: "This response should be sent to API" },
        ],
        timestamp: new Date().toISOString(),
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

  it("should include messages with isMeta flag in API conversion", () => {
    const messages: Message[] = [
      {
        id: generateMessageId(),
        role: "user",
        blocks: [{ type: "text", content: "Hidden message" }],
        isMeta: true,
        timestamp: new Date().toISOString(),
      },
    ];

    const apiMessages = convertMessagesForAPI(messages);

    expect(apiMessages).toHaveLength(1);
    expect(apiMessages[0].role).toBe("user");
    expect(apiMessages[0].content).toEqual([
      { type: "text", text: "Hidden message" },
    ]);
  });

  it("should wrap task_notification blocks with completion context for the model", () => {
    const messages: Message[] = [
      {
        id: generateMessageId(),
        role: "user",
        blocks: [
          {
            type: "task_notification",
            taskId: "task-1",
            taskType: "shell",
            status: "completed",
            summary: "Done",
          },
        ],
        isMeta: true,
        timestamp: new Date().toISOString(),
      },
    ];

    const apiMessages = convertMessagesForAPI(messages);

    expect(apiMessages).toHaveLength(1);
    expect(apiMessages[0].role).toBe("user");
    expect(apiMessages[0].content).toEqual([
      {
        type: "text",
        text: `A background agent completed a task:\n<task-notification>\n<task-id>task-1</task-id>\n<task-type>shell</task-type>\n<status>completed</status>\n<summary>Done</summary>\n</task-notification>`,
      },
    ]);
  });

  it("should include reasoning content in assistant messages for API", () => {
    const messages: Message[] = [
      {
        id: generateMessageId(),
        role: "user",
        blocks: [{ type: "text", content: "What is 2+2?" }],
        timestamp: new Date().toISOString(),
      },
      {
        id: generateMessageId(),
        role: "assistant",
        blocks: [
          {
            type: "reasoning",
            content: "Let me think about this...",
          },
          { type: "text", content: "The answer is 4." },
        ],
        timestamp: new Date().toISOString(),
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
        id: generateMessageId(),
        role: "user",
        blocks: [{ type: "text", content: "Explain quantum computing" }],
        timestamp: new Date().toISOString(),
      },
      {
        id: generateMessageId(),
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
        timestamp: new Date().toISOString(),
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

  it("should include reasoning-only assistant messages (truncated thinking preserved)", () => {
    const messages: Message[] = [
      {
        id: generateMessageId(),
        role: "user",
        blocks: [{ type: "text", content: "Write a chess engine" }],
        timestamp: new Date().toISOString(),
      },
      {
        id: generateMessageId(),
        role: "assistant",
        blocks: [
          {
            type: "reasoning",
            content:
              "Let me understand the task deeply... (truncated before any text or tool call)",
          },
        ],
        timestamp: new Date().toISOString(),
      },
    ];

    const apiMessages = convertMessagesForAPI(messages);

    expect(apiMessages).toHaveLength(2);

    expect(apiMessages[0].role).toBe("user");
    expect(apiMessages[1].role).toBe("assistant");
    const assistantMessage = apiMessages[1] as ChatCompletionMessageParam & {
      reasoning_content?: string;
    };
    // Reasoning-only messages fall back to an explanatory note as content
    // (OpenAI-compatible upstreams reject assistant messages without
    // content/tool_calls), while the thinking itself stays on the native
    // reasoning_content field so reasoning models continue from it.
    expect(assistantMessage.content).toBe(
      "[Note: The reasoning above was cut off before completion. It was auto-preserved from an interrupted or truncated turn — continue from where it left off, or disregard it if no longer relevant.]",
    );
    expect(assistantMessage.reasoning_content).toBe(
      "Let me understand the task deeply... (truncated before any text or tool call)",
    );
  });

  it("should filter out assistant messages with no content, tool calls, or reasoning", () => {
    const messages: Message[] = [
      {
        id: generateMessageId(),
        role: "user",
        blocks: [{ type: "text", content: "Hello" }],
        timestamp: new Date().toISOString(),
      },
      {
        id: generateMessageId(),
        role: "assistant",
        blocks: [
          { type: "reasoning", content: "   " },
          { type: "text", content: "" },
        ],
        timestamp: new Date().toISOString(),
      },
    ];

    const apiMessages = convertMessagesForAPI(messages);

    expect(apiMessages).toHaveLength(1);
    expect(apiMessages[0].role).toBe("user");
  });

  it("should not include reasoning_content when there are no reasoning blocks", () => {
    const messages: Message[] = [
      {
        id: generateMessageId(),
        role: "user",
        blocks: [{ type: "text", content: "Hello" }],
        timestamp: new Date().toISOString(),
      },
      {
        id: generateMessageId(),
        role: "assistant",
        blocks: [{ type: "text", content: "Hi there!" }],
        timestamp: new Date().toISOString(),
      },
    ];

    const apiMessages = convertMessagesForAPI(messages);

    expect(apiMessages).toHaveLength(2);
    const assistantMessage = apiMessages[1] as ChatCompletionMessageParam & {
      reasoning_content?: string;
    };
    expect(assistantMessage.reasoning_content).toBeUndefined();
  });

  it("should produce valid tool_call_id pairing for tool results with images", () => {
    // When a tool result contains images, it must still produce a role:"tool"
    // message, otherwise Claude API reports:
    // "tool_use ids were found without tool_result blocks"
    const messages: Message[] = [
      {
        id: generateMessageId(),
        role: "user",
        blocks: [{ type: "text", content: "Analyze this figma design" }],
        timestamp: new Date().toISOString(),
      },
      {
        id: generateMessageId(),
        role: "assistant",
        blocks: [
          {
            type: "tool",
            id: "tool_call_1",
            name: "get_design_context",
            parameters: '{"nodeId": "9804:91114"}',
            stage: "end",
            result: "const img = 'http://localhost/assets/abc.svg';",
            success: true,
          },
        ],
        timestamp: new Date().toISOString(),
      },
      {
        id: generateMessageId(),
        role: "assistant",
        blocks: [
          {
            type: "tool",
            id: "tool_call_2",
            name: "get_screenshot",
            parameters: '{"nodeId": "9804:91114"}',
            stage: "end",
            result: "Tool returned 1 image(s).",
            success: true,
            images: [{ data: "iVBORw0KGgoAAAANS...", mediaType: "image/png" }],
          },
        ],
        timestamp: new Date().toISOString(),
      },
    ];

    const apiMessages = convertMessagesForAPI(messages);

    // Find all assistant messages with tool_calls
    type AssistantWithTools = ChatCompletionMessageParam & {
      tool_calls: ChatCompletionMessageToolCall[];
    };
    const assistantWithToolCalls = apiMessages.filter(
      (m): m is AssistantWithTools =>
        m.role === "assistant" &&
        "tool_calls" in m &&
        Array.isArray((m as AssistantWithTools).tool_calls),
    );

    // For each assistant tool_call, there must be a role:"tool" message with matching tool_call_id
    for (const assistantMsg of assistantWithToolCalls) {
      const assistantIdx = apiMessages.indexOf(assistantMsg);

      for (const tc of assistantMsg.tool_calls) {
        const toolResult = apiMessages.find(
          (m, idx) =>
            idx > assistantIdx &&
            m.role === "tool" &&
            "tool_call_id" in m &&
            (m as unknown as { tool_call_id: string }).tool_call_id === tc.id,
        );
        expect(
          toolResult,
          `tool_call_id "${tc.id}" must have a corresponding role:"tool" message`,
        ).toBeDefined();
      }
    }
  });

  it("should handle single assistant message with image tool result correctly", () => {
    const messages: Message[] = [
      {
        id: generateMessageId(),
        role: "user",
        blocks: [{ type: "text", content: "Take a screenshot" }],
        timestamp: new Date().toISOString(),
      },
      {
        id: generateMessageId(),
        role: "assistant",
        blocks: [
          {
            type: "tool",
            id: "tool_img_1",
            name: "get_screenshot",
            parameters: '{"nodeId": "123"}',
            stage: "end",
            result: "Screenshot taken.",
            success: true,
            images: [{ data: "base64data", mediaType: "image/png" }],
          },
        ],
        timestamp: new Date().toISOString(),
      },
    ];

    const apiMessages = convertMessagesForAPI(messages);

    // The tool message must use role:"tool" with proper tool_call_id
    const toolMsg = apiMessages.find(
      (m) =>
        m.role === "tool" &&
        "tool_call_id" in m &&
        (m as unknown as { tool_call_id: string }).tool_call_id ===
          "tool_img_1",
    );
    expect(
      toolMsg,
      "Image tool result must still produce a role:'tool' message with tool_call_id",
    ).toBeDefined();

    // Image should also be present somewhere (as user message)
    type ContentPart = { type: string; image_url?: { url: string } };
    const userMsgWithImage = apiMessages.find(
      (m) =>
        m.role === "user" &&
        Array.isArray(m.content) &&
        (m.content as ContentPart[]).some((p) => p.type === "image_url"),
    );
    expect(
      userMsgWithImage,
      "Image data should be passed to the model via a user message",
    ).toBeDefined();
  });

  it("should not interleave user messages between tool messages for multi-tool calls", () => {
    const messages: Message[] = [
      {
        id: generateMessageId(),
        role: "user",
        blocks: [{ type: "text", content: "Do multiple things" }],
        timestamp: new Date().toISOString(),
      },
      {
        id: generateMessageId(),
        role: "assistant",
        blocks: [
          {
            type: "tool",
            id: "tc_a",
            name: "bash",
            parameters: '{"command": "ls"}',
            stage: "end",
            result: "file1.txt",
            success: true,
          },
          {
            type: "tool",
            id: "tc_b",
            name: "get_screenshot",
            parameters: '{"nodeId": "1"}',
            stage: "end",
            result: "Image captured.",
            success: true,
            images: [{ data: "imgdata", mediaType: "image/png" }],
          },
        ],
        timestamp: new Date().toISOString(),
      },
    ];

    const apiMessages = convertMessagesForAPI(messages);

    // Find the assistant message index
    const assistantIdx = apiMessages.findIndex(
      (m) => m.role === "assistant" && "tool_calls" in m,
    );
    expect(assistantIdx).toBeGreaterThanOrEqual(0);

    // All tool messages must come immediately after assistant (contiguously)
    const afterAssistant = apiMessages.slice(assistantIdx + 1);
    let foundNonTool = false;
    let toolCount = 0;
    for (const msg of afterAssistant) {
      if (msg.role === "tool") {
        expect(
          foundNonTool,
          "tool messages must be contiguous after assistant",
        ).toBe(false);
        toolCount++;
      } else {
        foundNonTool = true;
      }
    }
    expect(toolCount).toBe(2);
  });

  it("should convert compact block to user role for API (matching Claude Code auto-compact)", () => {
    const messages: Message[] = [
      {
        id: generateMessageId(),
        role: "assistant",
        blocks: [
          {
            type: "compact",
            content:
              "[Compacted Message Summary] User asked to refactor a function...",
          },
        ],
        timestamp: new Date().toISOString(),
      },
      {
        id: generateMessageId(),
        role: "user",
        blocks: [{ type: "text", content: "Continue refactoring" }],
        timestamp: new Date().toISOString(),
      },
      {
        id: generateMessageId(),
        role: "assistant",
        blocks: [{ type: "text", content: "Here is the refactored code." }],
        timestamp: new Date().toISOString(),
      },
    ];

    const apiMessages = convertMessagesForAPI(messages);

    expect(apiMessages).toHaveLength(3);
    // The compact block should be converted to a user message
    expect(apiMessages[0].role).toBe("user");
    expect(apiMessages[0].content).toBe(
      "[Compacted Message Summary] User asked to refactor a function...",
    );
    // Subsequent messages should retain their original roles
    expect(apiMessages[1].role).toBe("user");
    expect(apiMessages[2].role).toBe("assistant");
  });

  describe("supportsVision option", () => {
    it("should replace user ImageBlock with text placeholder when supportsVision is false", () => {
      const messages: Message[] = [
        {
          id: generateMessageId(),
          role: "user",
          blocks: [
            { type: "text", content: "What is in this image?" },
            {
              type: "image",
              imageUrls: ["data:image/png;base64,iVBORw0KGgoAAAANS..."],
            },
          ],
          timestamp: new Date().toISOString(),
        },
      ];

      const apiMessages = convertMessagesForAPI(messages, {
        supportsVision: false,
      });

      expect(apiMessages).toHaveLength(1);
      expect(apiMessages[0].role).toBe("user");
      const content = apiMessages[0].content as Array<{
        type: string;
        text?: string;
      }>;
      expect(content).toHaveLength(2);
      expect(content[0]).toEqual({
        type: "text",
        text: "What is in this image?",
      });
      expect(content[1].type).toBe("text");
      expect(content[1].text).toContain("does not support image recognition");

      // Ensure no image_url parts remain
      const allContent = JSON.stringify(apiMessages);
      expect(allContent).not.toContain("image_url");
    });

    it("should replace tool result images with text placeholder when supportsVision is false", () => {
      const messages: Message[] = [
        {
          id: generateMessageId(),
          role: "user",
          blocks: [{ type: "text", content: "Take a screenshot" }],
          timestamp: new Date().toISOString(),
        },
        {
          id: generateMessageId(),
          role: "assistant",
          blocks: [
            {
              type: "tool",
              id: "tool_img_1",
              name: "get_screenshot",
              parameters: '{"nodeId": "123"}',
              stage: "end",
              result: "Screenshot taken.",
              success: true,
              images: [{ data: "base64data", mediaType: "image/png" }],
            },
          ],
          timestamp: new Date().toISOString(),
        },
      ];

      const apiMessages = convertMessagesForAPI(messages, {
        supportsVision: false,
      });

      // Find the user message that contains the placeholder (not the original text)
      type ContentPart = { type: string; text?: string; image_url?: unknown };
      const userMessages = apiMessages.filter((m) => m.role === "user");

      // The placeholder should be in one of the user messages (string or array content)
      const placeholderFound = userMessages.some((m) => {
        if (typeof m.content === "string") {
          return m.content.includes("does not support image recognition");
        }
        if (Array.isArray(m.content)) {
          const parts = m.content as ContentPart[];
          return parts.some(
            (p) =>
              p.type === "text" &&
              typeof p.text === "string" &&
              p.text.includes("does not support image recognition"),
          );
        }
        return false;
      });
      expect(placeholderFound).toBe(true);

      // Ensure no image_url parts remain
      const allContent = JSON.stringify(apiMessages);
      expect(allContent).not.toContain("image_url");
    });

    it("should append [Image source: <path>] for persisted tool images when supportsVision is false", () => {
      const messages: Message[] = [
        {
          id: generateMessageId(),
          role: "user",
          blocks: [{ type: "text", content: "Take a screenshot" }],
          timestamp: new Date().toISOString(),
        },
        {
          id: generateMessageId(),
          role: "assistant",
          blocks: [
            {
              type: "tool",
              id: "tool_img_1",
              name: "get_screenshot",
              parameters: '{"nodeId": "123"}',
              stage: "end",
              result: "Screenshot taken.",
              success: true,
              images: [
                {
                  data: "base64data",
                  mediaType: "image/png",
                  path: "/tmp/wave-mcp-images/mcp-image_1_abc123.png",
                },
              ],
            },
          ],
          timestamp: new Date().toISOString(),
        },
      ];

      const apiMessages = convertMessagesForAPI(messages, {
        supportsVision: false,
      });

      type ContentPart = { type: string; text?: string };
      const userMessages = apiMessages.filter((m) => m.role === "user");
      const placeholderMessage = userMessages.find((m) => {
        if (typeof m.content === "string") {
          return m.content.includes("does not support image recognition");
        }
        if (Array.isArray(m.content)) {
          const parts = m.content as ContentPart[];
          return parts.some(
            (p) =>
              p.type === "text" &&
              typeof p.text === "string" &&
              p.text.includes("does not support image recognition"),
          );
        }
        return false;
      });
      expect(placeholderMessage).toBeDefined();
      const parts = placeholderMessage!.content as ContentPart[];
      expect(parts).toHaveLength(2);
      expect(parts[1]).toEqual({
        type: "text",
        text: "[Image source: /tmp/wave-mcp-images/mcp-image_1_abc123.png]",
      });

      // Ensure no image_url parts remain
      const allContent = JSON.stringify(apiMessages);
      expect(allContent).not.toContain("image_url");
    });

    it("should append one [Image source: <path>] line per persisted image when supportsVision is false", () => {
      const messages: Message[] = [
        {
          id: generateMessageId(),
          role: "assistant",
          blocks: [
            {
              type: "tool",
              id: "tool_img_2",
              name: "get_screenshots",
              parameters: "{}",
              stage: "end",
              result: "Two screenshots.",
              success: true,
              images: [
                {
                  data: "base64data",
                  mediaType: "image/png",
                  path: "/tmp/wave-mcp-images/mcp-image_1_abc123.png",
                },
                {
                  data: "base64data",
                  mediaType: "image/jpeg",
                  path: "/tmp/wave-mcp-images/mcp-image_2_def456.jpg",
                },
              ],
            },
          ],
          timestamp: new Date().toISOString(),
        },
      ];

      const apiMessages = convertMessagesForAPI(messages, {
        supportsVision: false,
      });

      type ContentPart = { type: string; text?: string };
      const userMessages = apiMessages.filter((m) => m.role === "user");
      expect(userMessages).toHaveLength(1);
      const parts = userMessages[0].content as ContentPart[];
      expect(parts).toHaveLength(3);
      expect(parts[0].text).toContain("does not support image recognition");
      expect(parts[1].text).toBe(
        "[Image source: /tmp/wave-mcp-images/mcp-image_1_abc123.png]",
      );
      expect(parts[2].text).toBe(
        "[Image source: /tmp/wave-mcp-images/mcp-image_2_def456.jpg]",
      );
    });

    it("should keep sending persisted tool images as image_url when supportsVision is true", () => {
      const messages: Message[] = [
        {
          id: generateMessageId(),
          role: "assistant",
          blocks: [
            {
              type: "tool",
              id: "tool_img_3",
              name: "get_screenshot",
              parameters: "{}",
              stage: "end",
              result: "Screenshot taken.",
              success: true,
              images: [
                {
                  data: "base64data",
                  mediaType: "image/png",
                  path: "/tmp/wave-mcp-images/mcp-image_1_abc123.png",
                },
              ],
            },
          ],
          timestamp: new Date().toISOString(),
        },
      ];

      const apiMessages = convertMessagesForAPI(messages, {
        supportsVision: true,
      });

      const allContent = JSON.stringify(apiMessages);
      expect(allContent).toContain("image_url");
      expect(allContent).toContain("data:image/png;base64,base64data");
      // The persisted path is metadata for the non-vision path only
      expect(allContent).not.toContain("[Image source:");
    });

    it("should send images as image_url when supportsVision is true (default)", () => {
      const messages: Message[] = [
        {
          id: generateMessageId(),
          role: "user",
          blocks: [
            { type: "text", content: "What is in this image?" },
            {
              type: "image",
              imageUrls: ["data:image/png;base64,iVBORw0KGgoAAAANS..."],
            },
          ],
          timestamp: new Date().toISOString(),
        },
      ];

      // Default (no options) = supportsVision undefined = true
      const apiMessagesDefault = convertMessagesForAPI(messages);
      const allContentDefault = JSON.stringify(apiMessagesDefault);
      expect(allContentDefault).toContain("image_url");

      // Explicitly true
      const apiMessagesTrue = convertMessagesForAPI(messages, {
        supportsVision: true,
      });
      const allContentTrue = JSON.stringify(apiMessagesTrue);
      expect(allContentTrue).toContain("image_url");
    });
  });

  describe("image source path metadata (aligned with Claude Code)", () => {
    it("appends [Image source: <path>] text after the image part for local file paths", () => {
      const messages: Message[] = [
        {
          id: generateMessageId(),
          role: "user",
          blocks: [
            { type: "text", content: "What is in this screenshot?" },
            {
              type: "image",
              imageUrls: ["/tmp/clipboard-image-123.png"],
            },
          ],
          timestamp: new Date().toISOString(),
        },
      ];

      const apiMessages = convertMessagesForAPI(messages);

      expect(apiMessages).toHaveLength(1);
      const content = apiMessages[0].content as Array<{
        type: string;
        text?: string;
        image_url?: { url: string };
      }>;
      expect(content).toEqual([
        { type: "text", text: "What is in this screenshot?" },
        {
          type: "image_url",
          image_url: {
            url: `data:image/png;base64,${Buffer.from("mock:/tmp/clipboard-image-123.png").toString("base64")}`,
            detail: "auto",
          },
        },
        {
          type: "text",
          text: "[Image source: /tmp/clipboard-image-123.png]",
        },
      ]);
    });

    it("does not append source metadata for inline dataURL images", () => {
      const messages: Message[] = [
        {
          id: generateMessageId(),
          role: "user",
          blocks: [
            { type: "text", content: "What is in this image?" },
            {
              type: "image",
              imageUrls: ["data:image/png;base64,iVBORw0KGgoAAAANS..."],
            },
          ],
          timestamp: new Date().toISOString(),
        },
      ];

      const apiMessages = convertMessagesForAPI(messages);

      const content = apiMessages[0].content as Array<{
        type: string;
        text?: string;
      }>;
      expect(
        content.some(
          (p) => p.type === "text" && p.text?.startsWith("[Image source:"),
        ),
      ).toBe(false);
    });

    it("appends [Image source: <path>] alongside placeholder when supportsVision is false", () => {
      const messages: Message[] = [
        {
          id: generateMessageId(),
          role: "user",
          blocks: [
            { type: "text", content: "What is in this image?" },
            {
              type: "image",
              imageUrls: ["/tmp/clipboard-image-123.png"],
            },
          ],
          timestamp: new Date().toISOString(),
        },
      ];

      const apiMessages = convertMessagesForAPI(messages, {
        supportsVision: false,
      });

      expect(apiMessages).toHaveLength(1);
      const content = apiMessages[0].content as Array<{
        type: string;
        text?: string;
      }>;
      // Placeholder + [Image source: path] metadata so a non-vision main model
      // can delegate recognition to the vision subagent
      expect(content).toEqual([
        { type: "text", text: "What is in this image?" },
        {
          type: "text",
          text: "[User shared an image, but the current model does not support image recognition]",
        },
        {
          type: "text",
          text: "[Image source: /tmp/clipboard-image-123.png]",
        },
      ]);

      // Ensure no image_url parts remain
      const allContent = JSON.stringify(apiMessages);
      expect(allContent).not.toContain("image_url");
    });

    it("appends [Image source: <path>] for each non-dataURL image when supportsVision is false", () => {
      const messages: Message[] = [
        {
          id: generateMessageId(),
          role: "user",
          blocks: [
            { type: "text", content: "Describe both images" },
            {
              type: "image",
              imageUrls: [
                "/tmp/image-a.png",
                "data:image/png;base64,iVBORw0KGgoAAAANS...",
                "/tmp/image-b.jpg",
              ],
            },
          ],
          timestamp: new Date().toISOString(),
        },
      ];

      const apiMessages = convertMessagesForAPI(messages, {
        supportsVision: false,
      });

      const content = apiMessages[0].content as Array<{
        type: string;
        text?: string;
      }>;
      const sourcePaths = content
        .filter(
          (p) => p.type === "text" && p.text?.startsWith("[Image source:"),
        )
        .map((p) => p.text);
      expect(sourcePaths).toEqual([
        "[Image source: /tmp/image-a.png]",
        "[Image source: /tmp/image-b.jpg]",
      ]);
    });
  });
});
