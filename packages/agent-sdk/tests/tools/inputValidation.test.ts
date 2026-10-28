import { describe, it, expect } from "vitest";
import { validateToolInput } from "../../src/tools/inputValidation.js";
import { askUserQuestionTool } from "../../src/tools/askUserQuestion.js";

import type { ToolPlugin } from "../../src/tools/types.js";
/** The schema TaskUpdate actually declares, trimmed to what these tests need. */
const TASK_UPDATE = {
  type: "object",
  properties: {
    taskId: { type: "string" },
    status: { type: "string", enum: ["pending", "in_progress", "completed"] },
    addBlocks: { type: "array", items: { type: "string" } },
    metadata: {},
  },
  required: ["taskId"],
};

describe("validateToolInput", () => {
  it("accepts a call that matches the declaration", () => {
    expect(
      validateToolInput("TaskUpdate", TASK_UPDATE, {
        taskId: "2",
        status: "completed",
      }),
    ).toBeNull();
  });

  it("leaves a tool without a schema alone", () => {
    expect(validateToolInput("FakeTool", {}, { anything: 1 })).toBeNull();
    expect(
      validateToolInput("FakeTool", undefined, { anything: 1 }),
    ).toBeNull();
  });

  it("names the missing required parameter and the tool", () => {
    // The exact call that motivated this layer: `id` is not a parameter.
    const message = validateToolInput("TaskUpdate", TASK_UPDATE, {
      id: "2",
      status: "completed",
    });

    expect(message).toBe(
      [
        "TaskUpdate failed due to the following issues:",
        "The required parameter `taskId` is missing",
        "An unexpected parameter `id` was provided",
      ].join("\n"),
    );
  });

  it("reports a wrong type with both sides", () => {
    expect(
      validateToolInput(
        "Read",
        {
          type: "object",
          properties: {
            file_path: { type: "string" },
            offset: { type: "number" },
          },
          required: ["file_path"],
        },
        { file_path: "/tmp/a", offset: "20" },
      ),
    ).toBe(
      [
        "Read failed due to the following issue:",
        "The parameter `offset` type is expected as `number` but provided as `string`",
      ].join("\n"),
    );
  });

  it("rejects a value outside an enum", () => {
    expect(
      validateToolInput("TaskUpdate", TASK_UPDATE, {
        taskId: "2",
        status: "done",
      }),
    ).toBe(
      [
        "TaskUpdate failed due to the following issue:",
        'The parameter `status` is invalid: expected one of "pending", "in_progress", "completed"',
      ].join("\n"),
    );
  });

  it("treats an integer as a number but not the other way round", () => {
    const schema = {
      type: "object",
      properties: { a: { type: "number" }, b: { type: "integer" } },
    };
    expect(validateToolInput("T", schema, { a: 1, b: 2 })).toBeNull();
    expect(validateToolInput("T", schema, { a: 1.5 })).toBeNull();
    expect(validateToolInput("T", schema, { b: 1.5 })).toContain(
      "The parameter `b` type is expected as `integer` but provided as `number`",
    );
  });

  it("counts null as a type mismatch, not as a missing parameter", () => {
    const message = validateToolInput(
      "Read",
      {
        type: "object",
        properties: { limit: { type: "number" } },
      },
      { limit: null },
    );

    expect(message).toBe(
      [
        "Read failed due to the following issue:",
        "The parameter `limit` type is expected as `number` but provided as `null`",
      ].join("\n"),
    );
  });

  it("accepts null when the schema allows it", () => {
    expect(
      validateToolInput(
        "T",
        {
          type: "object",
          properties: { limit: { type: ["number", "null"] } },
        },
        { limit: null },
      ),
    ).toBeNull();
  });

  it("checks nested objects and array items", () => {
    const schema = {
      type: "object",
      properties: {
        questions: {
          type: "array",
          items: {
            type: "object",
            properties: { question: { type: "string" } },
            required: ["question"],
          },
        },
      },
      required: ["questions"],
    };

    expect(
      validateToolInput("AskUserQuestion", schema, {
        questions: [{ question: "ok" }, { label: "missing question" }],
      }),
    ).toBe(
      [
        "AskUserQuestion failed due to the following issues:",
        "The required parameter `questions[1].question` is missing",
        "An unexpected parameter `questions[1].label` was provided",
      ].join("\n"),
    );
  });

  it("lets a declared free-form map through, checking its values instead", () => {
    const schema = {
      type: "object",
      properties: {
        metadata: { type: "object", additionalProperties: { type: "string" } },
      },
    };

    // Any key is fine …
    expect(
      validateToolInput("AskUserQuestion", schema, {
        metadata: { source: "remember", anything: "yes" },
      }),
    ).toBeNull();
    // … but the values are still typed.
    expect(
      validateToolInput("AskUserQuestion", schema, { metadata: { source: 3 } }),
    ).toContain(
      "The parameter `metadata.source` type is expected as `string` but provided as `integer`",
    );
  });

  it("honours additionalProperties: true", () => {
    expect(
      validateToolInput(
        "T",
        {
          type: "object",
          properties: { a: { type: "string" } },
          additionalProperties: true,
        },
        { a: "x", whatever: 1 },
      ),
    ).toBeNull();
  });

  it("lists every issue rather than stopping at the first", () => {
    const message = validateToolInput(
      "T",
      {
        type: "object",
        properties: {
          a: { type: "string" },
          b: { type: "number" },
          c: { type: "boolean" },
        },
        required: ["a"],
      },
      { b: "2", c: 3, zzz: true },
    );

    expect(message?.split("\n")).toEqual([
      "T failed due to the following issues:",
      "The required parameter `a` is missing",
      "An unexpected parameter `zzz` was provided",
      "The parameter `b` type is expected as `number` but provided as `string`",
      "The parameter `c` type is expected as `boolean` but provided as `integer`",
    ]);
  });

  it("does not descend into a value whose type is already wrong", () => {
    const message = validateToolInput(
      "T",
      {
        type: "object",
        properties: {
          questions: {
            type: "array",
            items: { type: "object", required: ["question"] },
          },
        },
      },
      { questions: "nope" },
    );

    // One honest report beats "expected an array" plus a bogus "questions[0] missing".
    expect(message?.split("\n")).toHaveLength(2);
  });
});

describe("validateToolInput reaches the fields inside options", () => {
  /**
   * The schema the model is actually given. `questions[0].options[0].label` is
   * six object/array levels below the argument object, which is what pins
   * `MAX_DEPTH` in the walker: at 4 nothing inside `options` was examined, so a
   * missing or mistyped `label` passed the generic layer untouched.
   */
  const parameters = askUserQuestionTool.config.function.parameters;

  /** One complete question whose only variation is the options list. */
  function callWith(options: unknown[]) {
    return {
      questions: [{ question: "Which library?", header: "Library", options }],
    };
  }

  it("reports an option that has no label", () => {
    const message = validateToolInput(
      "AskUserQuestion",
      parameters,
      callWith([{ label: "A" }, { description: "only a description" }]),
    );

    expect(message).toBe(
      [
        "AskUserQuestion failed due to the following issue:",
        "The required parameter `questions[0].options[1].label` is missing",
      ].join("\n"),
    );
  });

  it("reports an option whose label is not a string", () => {
    const message = validateToolInput(
      "AskUserQuestion",
      parameters,
      callWith([{ label: "A" }, { label: 42 }]),
    );

    expect(message).toBe(
      [
        "AskUserQuestion failed due to the following issue:",
        "The parameter `questions[0].options[1].label` type is expected as `string` but provided as `integer`",
      ].join("\n"),
    );
  });

  it("accepts an empty label — 'non-blank' is the tool's rule, not the schema's", () => {
    // `""` is a valid `string`, and the schema subset here has no `minLength`,
    // so the generic layer has nothing to report. Rejecting a blank label needs
    // `label.trim() !== ""`, which lives in `askUserQuestion.execute()`
    // (`collectOptionLabelErrors`) — this layer must not duplicate it.
    expect(
      validateToolInput(
        "AskUserQuestion",
        parameters,
        callWith([{ label: "A" }, { label: "" }]),
      ),
    ).toBeNull();
  });

  it("still accepts a well-formed call", () => {
    expect(
      validateToolInput(
        "AskUserQuestion",
        parameters,
        callWith([
          { label: "A", description: "the first option" },
          { label: "B" },
        ]),
      ),
    ).toBeNull();
  });
});

describe("validateToolInput against the real built-in schemas", () => {
  /**
   * A minimal call for a schema: every required property filled with a value of
   * its declared type. This is the safety net for the validator itself — if it
   * misreads one of wave's own schemas (nested arrays, `enum`s, keys like `-B`),
   * the tool would start rejecting valid calls, and this fails instead.
   */
  function minimalValue(schema: Record<string, unknown>): unknown {
    if (Array.isArray(schema.enum) && schema.enum.length > 0) {
      return schema.enum[0];
    }
    switch (schema.type) {
      case "string":
        return "x";
      case "number":
      case "integer":
        return 1;
      case "boolean":
        return true;
      case "array":
        return [];
      case "object":
        return {};
      default:
        return "x";
    }
  }

  it("accepts a minimal valid call for every built-in tool", async () => {
    const modules = await Promise.all([
      import("../../src/tools/bashTool.js"),
      import("../../src/tools/taskStopTool.js"),
      import("../../src/tools/editTool.js"),
      import("../../src/tools/writeTool.js"),
      import("../../src/tools/readTool.js"),
      import("../../src/tools/globTool.js"),
      import("../../src/tools/grepTool.js"),
      import("../../src/tools/lspTool.js"),
      import("../../src/tools/skillTool.js"),
      import("../../src/tools/agentTool.js"),
      import("../../src/tools/exitPlanMode.js"),
      import("../../src/tools/enterPlanMode.js"),
      import("../../src/tools/askUserQuestion.js"),
      import("../../src/tools/cronCreateTool.js"),
      import("../../src/tools/cronDeleteTool.js"),
      import("../../src/tools/webFetchTool.js"),
      import("../../src/tools/enterWorktreeTool.js"),
      import("../../src/tools/exitWorktreeTool.js"),
      import("../../src/tools/workflowTool.js"),
      import("../../src/tools/execTool.js"),
      import("../../src/tools/taskManagementTools.js"),
    ]);

    const plugins = modules
      .flatMap((module) => Object.values(module))
      .filter(
        (value): value is ToolPlugin =>
          typeof value === "object" &&
          value !== null &&
          "config" in value &&
          typeof (value as ToolPlugin).name === "string",
      );

    expect(plugins.length).toBeGreaterThan(20);

    for (const plugin of plugins) {
      const parameters = plugin.config?.function?.parameters as
        | Record<string, unknown>
        | undefined;
      const properties =
        (parameters?.properties as Record<string, unknown> | undefined) ?? {};
      const required = (parameters?.required as string[] | undefined) ?? [];
      const args: Record<string, unknown> = {};
      for (const name of required) {
        args[name] = minimalValue(
          (properties[name] as Record<string, unknown>) ?? {},
        );
      }

      expect(
        validateToolInput(plugin.name, parameters, args),
        `${plugin.name} rejected its own minimal call`,
      ).toBeNull();
    }
  });
});
