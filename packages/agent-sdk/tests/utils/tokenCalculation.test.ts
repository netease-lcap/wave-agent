import { describe, it, expect } from "vitest";
import {
  extractLatestTotalTokens,
  estimateContextTokens,
  roughTokenCountForMessages,
} from "@/utils/tokenCalculation.js";
import type { Message, Usage } from "@/types/index.js";

function makeMessage(overrides: Partial<Message>): Message {
  return {
    id: "m1",
    role: "user",
    blocks: [],
    timestamp: "2026-08-19T00:00:00.000Z",
    ...overrides,
  };
}

// 4 non-CJK chars ≈ 1 token; 2 chars/token for json
const TEXT_TOKENS = 100;
const text400 = "a".repeat(400);

describe("extractLatestTotalTokens", () => {
  it("should return 0 for empty array", () => {
    const messages: Array<{ usage?: Usage }> = [];
    const result = extractLatestTotalTokens(messages);
    expect(result).toBe(0);
  });

  it("should return 0 when no messages have usage data", () => {
    const messages: Array<{ usage?: Usage }> = [
      { usage: undefined },
      { usage: undefined },
      { usage: undefined },
    ];

    const result = extractLatestTotalTokens(messages);
    expect(result).toBe(0);
  });

  it("should return 0 when messages have undefined usage", () => {
    const messages: Array<{ usage?: Usage }> = [
      { usage: undefined },
      { usage: undefined },
    ];

    const result = extractLatestTotalTokens(messages);
    expect(result).toBe(0);
  });

  it("should extract tokens from single message with usage", () => {
    const usage: Usage = {
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
    };

    const messages: Array<{ usage?: Usage }> = [{ usage }];

    const result = extractLatestTotalTokens(messages);
    expect(result).toBe(150);
  });

  it("should extract total_tokens from last message with usage when multiple messages have usage", () => {
    const usage1: Usage = {
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
      cache_read_input_tokens: 10,
    };

    const usage2: Usage = {
      prompt_tokens: 200,
      completion_tokens: 75,
      total_tokens: 275,
      cache_creation_input_tokens: 25,
    };

    const messages: Array<{ usage?: Usage }> = [
      { usage: usage1 },
      { usage: usage2 },
    ];

    const result = extractLatestTotalTokens(messages);
    expect(result).toBe(275); // total_tokens only (cache fields excluded)
  });

  it("should skip messages without usage and find the latest with usage", () => {
    const usage1: Usage = {
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
    };

    const usage2: Usage = {
      prompt_tokens: 200,
      completion_tokens: 75,
      total_tokens: 275,
      cache_read_input_tokens: 30,
    };

    const messages: Array<{ usage?: Usage }> = [
      { usage: usage1 },
      { usage: undefined }, // No usage
      { usage: usage2 },
      { usage: undefined }, // No usage
      { usage: undefined }, // No usage
    ];

    const result = extractLatestTotalTokens(messages);
    expect(result).toBe(275); // total_tokens only (cache fields excluded)
  });

  it("should use total_tokens only, ignoring cache tokens", () => {
    const usage: Usage = {
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
      cache_read_input_tokens: 25,
      cache_creation_input_tokens: 30,
    };

    const messages: Array<{ usage?: Usage }> = [
      { usage: undefined },
      { usage },
      { usage: undefined },
    ];

    const result = extractLatestTotalTokens(messages);
    expect(result).toBe(150); // 150 + 25 + 30 would be 205 if cache were added
  });

  it("should handle mixed message structures", () => {
    const usage1: Usage = {
      prompt_tokens: 50,
      completion_tokens: 25,
      total_tokens: 75,
    };

    const usage2: Usage = {
      prompt_tokens: 150,
      completion_tokens: 100,
      total_tokens: 250,
      cache_read_input_tokens: 40,
    };

    const messages: Array<{ usage?: Usage }> = [
      { usage: undefined },
      { usage: usage1 },
      { usage: undefined },
      { usage: usage2 },
      { usage: undefined },
    ];

    const result = extractLatestTotalTokens(messages);
    expect(result).toBe(250); // total_tokens only (cache fields excluded)
  });

  it("should handle large arrays efficiently", () => {
    const usage: Usage = {
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
      cache_creation_input_tokens: 20,
    };

    // Create a large array with usage data only in the last message
    const messages: Array<{ usage?: Usage }> = Array.from(
      { length: 1000 },
      (_, i) => ({
        usage: i === 999 ? usage : undefined,
      }),
    );

    const result = extractLatestTotalTokens(messages);
    expect(result).toBe(150); // total_tokens only (cache fields excluded)
  });

  it("should handle messages with zero tokens", () => {
    const usage: Usage = {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
      cache_read_input_tokens: 10,
    };

    const messages: Array<{ usage?: Usage }> = [{ usage }];

    const result = extractLatestTotalTokens(messages);
    expect(result).toBe(0); // total_tokens only (cache fields excluded)
  });

  it("should handle messages with only cache_creation_input_tokens", () => {
    const usage: Usage = {
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
      cache_creation_input_tokens: 35,
    };

    const messages: Array<{ usage?: Usage }> = [{ usage }];

    const result = extractLatestTotalTokens(messages);
    expect(result).toBe(150); // total_tokens only (cache fields excluded)
  });

  it("should prioritize most recent usage even with intervening messages", () => {
    const earlyUsage: Usage = {
      prompt_tokens: 50,
      completion_tokens: 25,
      total_tokens: 75,
      cache_read_input_tokens: 100, // High cache read
    };

    const laterUsage: Usage = {
      prompt_tokens: 20,
      completion_tokens: 10,
      total_tokens: 30,
      cache_creation_input_tokens: 5, // Low cache creation
    };

    const messages: Array<{ usage?: Usage }> = [
      { usage: earlyUsage },
      { usage: undefined },
      { usage: undefined },
      { usage: undefined },
      { usage: laterUsage },
      { usage: undefined },
    ];

    // Should use laterUsage total_tokens (30), not earlyUsage (75)
    const result = extractLatestTotalTokens(messages);
    expect(result).toBe(30);
  });
});

describe("roughTokenCountForMessages", () => {
  it("should return 0 for messages without blocks", () => {
    expect(roughTokenCountForMessages([makeMessage({})])).toBe(0);
    expect(roughTokenCountForMessages([])).toBe(0);
  });

  it("should count text, reasoning, error and compact block content", () => {
    const messages = [
      makeMessage({
        blocks: [
          { type: "text", content: text400 },
          { type: "reasoning", content: text400 },
          { type: "error", content: text400 },
          { type: "compact", content: text400 },
        ],
      }),
    ];
    expect(roughTokenCountForMessages(messages)).toBe(TEXT_TOKENS * 4);
  });

  it("should count tool parameters (json ratio) and result", () => {
    const messages = [
      makeMessage({
        blocks: [
          {
            type: "tool",
            name: "Read",
            stage: "end",
            parameters: "b".repeat(400), // json: 400/2 = 200
            result: "c".repeat(400), // 400/4 = 100
          },
        ],
      }),
    ];
    expect(roughTokenCountForMessages(messages)).toBe(300);
  });

  it("should count task_notification summary", () => {
    const messages = [
      makeMessage({
        blocks: [
          {
            type: "task_notification",
            taskId: "t1",
            taskType: "shell",
            status: "completed",
            summary: "f".repeat(400),
          },
        ],
      }),
    ];
    expect(roughTokenCountForMessages(messages)).toBe(TEXT_TOKENS);
  });

  it("should ignore image and file_history blocks", () => {
    const messages = [
      makeMessage({
        blocks: [
          { type: "image", imageUrls: ["http://example.com/x.png"] },
          { type: "file_history", snapshots: [] },
          { type: "text", content: text400 },
        ],
      }),
    ];
    expect(roughTokenCountForMessages(messages)).toBe(TEXT_TOKENS);
  });
});

describe("estimateContextTokens", () => {
  it("should fall back to pure character estimate when no usage anchor exists", () => {
    const messages = [
      makeMessage({ blocks: [{ type: "text", content: text400 }] }),
    ];
    expect(estimateContextTokens(messages)).toBe(TEXT_TOKENS);
  });

  it("should anchor on latest usage total_tokens plus messages after it", () => {
    const anchorUsage: Usage = {
      prompt_tokens: 400,
      completion_tokens: 100,
      total_tokens: 500,
      cache_read_input_tokens: 3000, // must NOT be added (OpenAI semantics)
    };
    const messages = [
      // Before the anchor — ignored
      makeMessage({ blocks: [{ type: "text", content: text400 }] }),
      // The usage anchor itself — contributes total_tokens only
      makeMessage({
        role: "assistant",
        usage: anchorUsage,
        blocks: [{ type: "text", content: text400 }],
      }),
      // After the anchor — rough estimate
      makeMessage({ blocks: [{ type: "text", content: text400 }] }),
      makeMessage({
        blocks: [
          { type: "tool", name: "Bash", stage: "end", result: "c".repeat(400) },
        ],
      }),
    ];
    // 500 (total_tokens) + 100 (post-anchor text) + 100 (tool result)
    expect(estimateContextTokens(messages)).toBe(700);
  });

  it("should use the most recent usage anchor only", () => {
    const messages = [
      makeMessage({
        role: "assistant",
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
        },
        blocks: [],
      }),
      makeMessage({ blocks: [{ type: "text", content: text400 }] }),
      makeMessage({
        role: "assistant",
        usage: {
          prompt_tokens: 200,
          completion_tokens: 100,
          total_tokens: 300,
        },
        blocks: [],
      }),
      makeMessage({ blocks: [{ type: "text", content: text400 }] }),
    ];
    expect(estimateContextTokens(messages)).toBe(300 + TEXT_TOKENS);
  });
});
