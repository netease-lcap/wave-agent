import { describe, it, expect } from "vitest";
import {
  createStructuredOutputPrompt,
  createStructuredOutputTool,
  extractStructuredResult,
  STRUCTURED_OUTPUT_TOOL_NAME,
} from "../../src/workflow/structuredOutput.js";
import type { ToolContext } from "../../src/tools/types.js";

const testSchema = {
  type: "object",
  properties: {
    answer: { type: "string" },
    confidence: { type: "number" },
  },
  required: ["answer"],
};

describe("createStructuredOutputPrompt", () => {
  it("includes the schema in the prompt", () => {
    const prompt = createStructuredOutputPrompt(testSchema);
    expect(prompt).toContain(STRUCTURED_OUTPUT_TOOL_NAME);
    expect(prompt).toContain('"answer"');
    expect(prompt).toContain("JSON object matching this schema");
  });
});

describe("createStructuredOutputTool", () => {
  it("has correct name", () => {
    const tool = createStructuredOutputTool(testSchema);
    expect(tool.name).toBe(STRUCTURED_OUTPUT_TOOL_NAME);
  });

  it("has correct function config with schema as parameters", () => {
    const tool = createStructuredOutputTool(testSchema);
    expect(tool.config.type).toBe("function");
    expect(tool.config.function.name).toBe(STRUCTURED_OUTPUT_TOOL_NAME);
    expect(tool.config.function.parameters).toEqual(testSchema);
  });

  it("execute returns success with JSON-serialized args", async () => {
    const tool = createStructuredOutputTool(testSchema);
    const result = await tool.execute(
      { answer: "yes", confidence: 0.9 },
      {} as ToolContext,
    );
    expect(JSON.parse(result.content as string)).toEqual({
      answer: "yes",
      confidence: 0.9,
    });
  });
});

describe("extractStructuredResult", () => {
  it("finds result from tool_calls", () => {
    const messages = [
      {
        role: "assistant",
        content: "Let me compute this",
        tool_calls: [
          {
            function: {
              name: STRUCTURED_OUTPUT_TOOL_NAME,
              arguments: '{"answer": "42"}',
            },
          },
        ],
      },
    ];

    const result = extractStructuredResult(messages, testSchema);
    expect(result).toEqual({ answer: "42" });
  });

  it("falls back to JSON in text (code block)", () => {
    const messages = [
      {
        role: "assistant",
        content: 'Here is the result:\n```json\n{"answer": "maybe"}\n```',
      },
    ];

    const result = extractStructuredResult(messages, testSchema);
    expect(result).toEqual({ answer: "maybe" });
  });

  it("falls back to JSON in text (raw content)", () => {
    const messages = [
      {
        role: "assistant",
        content: '{"answer": "raw"}',
      },
    ];

    const result = extractStructuredResult(messages, testSchema);
    expect(result).toEqual({ answer: "raw" });
  });

  it("returns null when no structured output found", () => {
    const messages = [
      {
        role: "assistant",
        content: "I don't know the answer",
      },
    ];

    const result = extractStructuredResult(messages, testSchema);
    expect(result).toBeNull();
  });

  it("returns null when tool_calls exist but missing required fields", () => {
    const messages = [
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            function: {
              name: STRUCTURED_OUTPUT_TOOL_NAME,
              arguments: '{"confidence": 0.5}',
            },
          },
        ],
      },
    ];

    const result = extractStructuredResult(messages, testSchema);
    // Missing required "answer" field → validation fails → null
    expect(result).toBeNull();
  });

  it("prefers tool_calls over text fallback", () => {
    const messages = [
      {
        role: "assistant",
        content: '```json\n{"answer": "from-text"}\n```',
        tool_calls: [
          {
            function: {
              name: STRUCTURED_OUTPUT_TOOL_NAME,
              arguments: '{"answer": "from-tool"}',
            },
          },
        ],
      },
    ];

    const result = extractStructuredResult(messages, testSchema);
    expect(result).toEqual({ answer: "from-tool" });
  });
});
