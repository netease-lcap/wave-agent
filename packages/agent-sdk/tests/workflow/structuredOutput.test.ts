import { describe, it, expect } from "vitest";
import {
  createStructuredOutputNudge,
  createStructuredOutputPrompt,
  createStructuredOutputTool,
  extractStructuredResult,
  MAX_STRUCTURED_OUTPUT_RETRIES,
  prepareStructuredOutputSchema,
  STRUCTURED_OUTPUT_TOOL_NAME,
} from "../../src/workflow/structuredOutput.js";
import type {
  Message,
  MessageBlock,
  ToolBlock,
} from "../../src/types/messaging.js";
import type { ToolContext } from "../../src/tools/types.js";

const testSchema = {
  type: "object",
  properties: {
    answer: { type: "string" },
    confidence: { type: "number" },
  },
  required: ["answer"],
};

let messageSeq = 0;

/** Minimal `Message` for the block-shaped scanner. */
function message(role: "user" | "assistant", blocks: MessageBlock[]): Message {
  messageSeq += 1;
  return {
    id: `msg-${messageSeq}`,
    role,
    blocks,
    timestamp: new Date().toISOString(),
  };
}

/** A finished `StructuredOutput` tool block as the AIManager records it. */
function structuredOutputBlock(
  args: unknown,
  overrides: Partial<ToolBlock> = {},
): ToolBlock {
  return {
    type: "tool",
    name: STRUCTURED_OUTPUT_TOOL_NAME,
    stage: "end",
    parameters: typeof args === "string" ? args : JSON.stringify(args),
    success: true,
    ...overrides,
  };
}

describe("createStructuredOutputPrompt", () => {
  it("includes the schema in the prompt", () => {
    const prompt = createStructuredOutputPrompt(testSchema);
    expect(prompt).toContain(STRUCTURED_OUTPUT_TOOL_NAME);
    expect(prompt).toContain('"answer"');
    expect(prompt).toContain("JSON object matching this schema");
  });
});

describe("createStructuredOutputNudge", () => {
  it("uses Claude Code's verbatim nudge text", () => {
    expect(createStructuredOutputNudge()).toBe(
      "[structured-output-enforce] You MUST call the StructuredOutput tool to complete this request. Call this tool now.",
    );
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
    expect(tool.config.function.description).toBe(
      "Return structured output in the requested format",
    );
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

  it("execute fails (instead of accepting) when args violate the schema", async () => {
    const tool = createStructuredOutputTool(testSchema);
    const result = await tool.execute({ confidence: 0.5 }, {} as ToolContext);
    expect(result.success).toBe(false);
    expect(result.content).toContain("Output does not match required schema");
    expect(result.error).toBe(result.content);
  });

  it("execute surfaces an unusable schema as a failed call", async () => {
    // Fresh object so the memoized preparation of other tests cannot leak in.
    const tool = createStructuredOutputTool({ type: "array" });
    const result = await tool.execute({}, {} as ToolContext);
    expect(result.success).toBe(false);
    expect(result.content).toContain("unusable JSON Schema");
    expect(result.content).toContain("not started");
  });
});

describe("extractStructuredResult", () => {
  it("finds the result from a StructuredOutput tool block", async () => {
    const scan = await extractStructuredResult(
      [
        message("assistant", [
          { type: "text", content: "Let me compute this", stage: "end" },
          structuredOutputBlock({ answer: "42" }),
        ]),
      ],
      testSchema,
    );
    expect(scan.value).toEqual({ answer: "42" });
    expect(scan.error).toBeUndefined();
  });

  it("has no text fallback: a JSON blob in the final text is not a result", async () => {
    const scan = await extractStructuredResult(
      [
        message("assistant", [
          {
            type: "text",
            content: 'Here is the result:\n```json\n{"answer": "maybe"}\n```',
            stage: "end",
          },
        ]),
        message("assistant", [
          { type: "text", content: '{"answer": "raw"}', stage: "end" },
        ]),
      ],
      testSchema,
    );
    expect(scan.value).toBeUndefined();
    expect(scan.error).toBeUndefined();
  });

  it("ignores unfinished tool blocks (stage !== end)", async () => {
    const scan = await extractStructuredResult(
      [
        message("assistant", [
          structuredOutputBlock({ answer: "42" }, { stage: "running" }),
        ]),
      ],
      testSchema,
    );
    expect(scan.value).toBeUndefined();
    expect(scan.error).toBeUndefined();
  });

  it("ignores tool blocks of other tools", async () => {
    const scan = await extractStructuredResult(
      [
        message("assistant", [
          {
            type: "tool",
            name: "Bash",
            stage: "end",
            parameters: '{"command":"echo {\\"answer\\":\\"x\\"}"}',
            success: true,
          },
        ]),
      ],
      testSchema,
    );
    expect(scan.value).toBeUndefined();
  });

  it("reports a schema violation instead of a value", async () => {
    const scan = await extractStructuredResult(
      [message("assistant", [structuredOutputBlock({ confidence: 0.5 })])],
      testSchema,
    );
    expect(scan.value).toBeUndefined();
    expect(scan.error).toContain("Output does not match required schema");
    expect(scan.error).toContain("answer");
  });

  it("reports malformed arguments as an error", async () => {
    const scan = await extractStructuredResult(
      [message("assistant", [structuredOutputBlock("{not json")])],
      testSchema,
    );
    expect(scan.value).toBeUndefined();
    expect(scan.error).toContain("not valid JSON");
  });

  it("never accepts a call the harness rejected", async () => {
    const scan = await extractStructuredResult(
      [
        message("assistant", [
          structuredOutputBlock(
            { answer: "42" },
            {
              success: false,
              error: "Output does not match required schema: x",
            },
          ),
        ]),
      ],
      testSchema,
    );
    expect(scan.value).toBeUndefined();
    expect(scan.error).toBe("Output does not match required schema: x");
  });

  it("prefers the last valid call over an earlier one", async () => {
    const scan = await extractStructuredResult(
      [
        message("assistant", [structuredOutputBlock({ answer: "first" })]),
        message("user", [{ type: "text", content: "try again", stage: "end" }]),
        message("assistant", [structuredOutputBlock({ answer: "second" })]),
      ],
      testSchema,
    );
    expect(scan.value).toEqual({ answer: "second" });
  });

  it("keeps an earlier valid call when a later one is invalid", async () => {
    const scan = await extractStructuredResult(
      [
        message("assistant", [structuredOutputBlock({ answer: "first" })]),
        message("assistant", [structuredOutputBlock({ confidence: 1 })]),
      ],
      testSchema,
    );
    expect(scan.value).toEqual({ answer: "first" });
  });

  it("uses the most recent failure as the reported error", async () => {
    const scan = await extractStructuredResult(
      [
        message("assistant", [structuredOutputBlock({ confidence: 1 })]),
        message("assistant", [structuredOutputBlock("{oops")]),
      ],
      testSchema,
    );
    expect(scan.value).toBeUndefined();
    expect(scan.error).toContain("not valid JSON");
  });
});

describe("prepareStructuredOutputSchema", () => {
  it("compiles a validator that accepts matching and rejects mismatching output", async () => {
    const prepared = await prepareStructuredOutputSchema({
      type: "object",
      properties: { n: { type: "number" } },
      required: ["n"],
      additionalProperties: false,
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.validate({ n: 1 })).toEqual({ valid: true });
    const bad = prepared.validate({ n: "1" });
    expect(bad.valid).toBe(false);
    if (bad.valid) return;
    expect(bad.error).toContain("n");
  });

  it("rejects a structurally invalid schema", async () => {
    const prepared = await prepareStructuredOutputSchema({
      type: "object",
      properties: { n: { type: "nope" } },
    });
    expect(prepared.ok).toBe(false);
    if (prepared.ok) return;
    expect(prepared.message).toContain(
      "agent({schema}) received an invalid JSON Schema:",
    );
  });

  it("rejects a non-object root before the subagent starts", async () => {
    const prepared = await prepareStructuredOutputSchema({
      type: "array",
      items: { type: "string" },
    });
    expect(prepared.ok).toBe(false);
    if (prepared.ok) return;
    expect(prepared.message).toContain("unusable JSON Schema");
    expect(prepared.message).toContain("not started");
    expect(prepared.message).toContain("type: 'object'");
  });

  it("rejects an unsatisfiable sub-schema (required entry forbidden by additionalProperties)", async () => {
    const prepared = await prepareStructuredOutputSchema({
      type: "object",
      properties: { a: { type: "string" } },
      required: ["a", "b"],
      additionalProperties: false,
    });
    expect(prepared.ok).toBe(false);
    if (prepared.ok) return;
    expect(prepared.message).toContain("unusable JSON Schema");
    expect(prepared.message).toContain("b");
  });

  it("rejects a sub-schema whose type contradicts its enum", async () => {
    const prepared = await prepareStructuredOutputSchema({
      type: "object",
      properties: { kind: { type: "string", enum: [1, 2] } },
      required: ["kind"],
    });
    expect(prepared.ok).toBe(false);
    if (prepared.ok) return;
    expect(prepared.message).toContain("unusable JSON Schema");
    expect(prepared.message).toContain("kind");
  });

  it("rejects $async schemas", async () => {
    const prepared = await prepareStructuredOutputSchema({
      $async: true,
      type: "object",
    });
    expect(prepared.ok).toBe(false);
    if (prepared.ok) return;
    expect(prepared.message).toContain("$async");
  });

  it("memoizes per schema object (same promise, no recompilation)", () => {
    const schema = {
      type: "object",
      properties: { m: { type: "string" } },
      required: ["m"],
    };
    expect(prepareStructuredOutputSchema(schema)).toBe(
      prepareStructuredOutputSchema(schema),
    );
  });
});

describe("MAX_STRUCTURED_OUTPUT_RETRIES", () => {
  it("is 5, matching Claude Code's default cap", () => {
    expect(MAX_STRUCTURED_OUTPUT_RETRIES).toBe(5);
  });
});
