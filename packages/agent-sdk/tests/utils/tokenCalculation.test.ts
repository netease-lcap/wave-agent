import { describe, it, expect } from "vitest";
import {
  calculateComprehensiveTotalTokens,
  extractLatestTotalTokens,
} from "@/utils/tokenCalculation.js";
import type { Usage } from "@/types/index.js";

describe("calculateComprehensiveTotalTokens", () => {
  it("should calculate basic total tokens without cache tokens", () => {
    const usage: Usage = {
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
    };

    const result = calculateComprehensiveTotalTokens(usage);
    expect(result).toBe(150);
  });

  it("should include cache_read_input_tokens when present", () => {
    const usage: Usage = {
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
      cache_read_input_tokens: 25,
    };

    const result = calculateComprehensiveTotalTokens(usage);
    expect(result).toBe(175); // 150 + 25
  });

  it("should include cache_creation_input_tokens when present", () => {
    const usage: Usage = {
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
      cache_creation_input_tokens: 30,
    };

    const result = calculateComprehensiveTotalTokens(usage);
    expect(result).toBe(180); // 150 + 30
  });

  it("should include both cache token types when present", () => {
    const usage: Usage = {
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
      cache_read_input_tokens: 25,
      cache_creation_input_tokens: 30,
    };

    const result = calculateComprehensiveTotalTokens(usage);
    expect(result).toBe(205); // 150 + 25 + 30
  });

  it("should handle zero cache tokens", () => {
    const usage: Usage = {
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    };

    const result = calculateComprehensiveTotalTokens(usage);
    expect(result).toBe(150);
  });

  it("should handle undefined cache tokens as zero", () => {
    const usage: Usage = {
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
      cache_read_input_tokens: undefined,
      cache_creation_input_tokens: undefined,
    };

    const result = calculateComprehensiveTotalTokens(usage);
    expect(result).toBe(150);
  });

  it("should handle mixed defined/undefined cache tokens", () => {
    const usageWithReadOnly: Usage = {
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
      cache_read_input_tokens: 25,
      cache_creation_input_tokens: undefined,
    };

    expect(calculateComprehensiveTotalTokens(usageWithReadOnly)).toBe(175);

    const usageWithCreateOnly: Usage = {
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
      cache_read_input_tokens: undefined,
      cache_creation_input_tokens: 30,
    };

    expect(calculateComprehensiveTotalTokens(usageWithCreateOnly)).toBe(180);
  });

  it("should handle usage with additional optional fields", () => {
    const usage: Usage = {
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
      cache_read_input_tokens: 25,
      cache_creation_input_tokens: 30,
      model: "claude-3-sonnet",
      operation_type: "agent",
      cache_creation: {
        ephemeral_5m_input_tokens: 15,
        ephemeral_1h_input_tokens: 15,
      },
    };

    const result = calculateComprehensiveTotalTokens(usage);
    expect(result).toBe(205); // 150 + 25 + 30
  });

  it("should handle large token counts", () => {
    const usage: Usage = {
      prompt_tokens: 100000,
      completion_tokens: 50000,
      total_tokens: 150000,
      cache_read_input_tokens: 25000,
      cache_creation_input_tokens: 30000,
    };

    const result = calculateComprehensiveTotalTokens(usage);
    expect(result).toBe(205000); // 150000 + 25000 + 30000
  });

  it("should handle zero total tokens with cache tokens", () => {
    const usage: Usage = {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
      cache_read_input_tokens: 25,
      cache_creation_input_tokens: 30,
    };

    const result = calculateComprehensiveTotalTokens(usage);
    expect(result).toBe(55); // 0 + 25 + 30
  });
});

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

  it("should extract tokens from last message with usage when multiple messages have usage", () => {
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
    expect(result).toBe(300); // 275 + 25 (from usage2)
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
    expect(result).toBe(305); // 275 + 30 (from usage2, which is the latest with usage)
  });

  it("should use comprehensive calculation including cache tokens", () => {
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
    expect(result).toBe(205); // 150 + 25 + 30
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
    expect(result).toBe(290); // 250 + 40 (from usage2)
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
    expect(result).toBe(170); // 150 + 20
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
    expect(result).toBe(10); // 0 + 10
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
    expect(result).toBe(185); // 150 + 35
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

    // Should use laterUsage (30 + 5 = 35), not earlyUsage (75 + 100 = 175)
    const result = extractLatestTotalTokens(messages);
    expect(result).toBe(35);
  });
});
