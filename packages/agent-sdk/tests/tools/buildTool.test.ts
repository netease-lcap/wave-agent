import { describe, it, expect } from "vitest";
import { buildTool, type ToolDef } from "../../src/tools/buildTool.js";
import type { ToolPlugin, ToolContext } from "../../src/tools/types.js";

function makeContext(): ToolContext {
  return {
    workdir: "/tmp",
    taskManager:
      {} as unknown as import("@/services/taskManager.js").TaskManager,
  } as ToolContext;
}

describe("buildTool", () => {
  it("should create a basic tool with name, description, parameters, and execute", () => {
    const def: ToolDef = {
      name: "TestTool",
      description: "A test tool",
      parameters: {
        message: { type: "string", description: "A message" },
      },
      execute: async () => ({ success: true, content: "done" }),
    };

    const tool = buildTool(def);

    expect(tool.name).toBe("TestTool");
    expect(tool.config.type).toBe("function");
    expect(tool.config.function.name).toBe("TestTool");
    expect(tool.config.function.description).toBe("A test tool");
    expect(tool.config.function.parameters).toEqual({
      type: "object",
      properties: { message: { type: "string", description: "A message" } },
      required: [],
      additionalProperties: false,
    });
  });

  it("should create a tool with required array", () => {
    const def: ToolDef = {
      name: "RequiredTool",
      description: "Tool with required params",
      parameters: {
        name: { type: "string" },
        age: { type: "number" },
      },
      required: ["name"],
      execute: async () => ({ success: true, content: "" }),
    };

    const tool = buildTool(def);

    expect(tool.config.function.parameters!.required).toEqual(["name"]);
  });

  it("should normalize prompt string to a function", () => {
    const def: ToolDef = {
      name: "PromptStringTool",
      description: "Tool with string prompt",
      parameters: {},
      prompt: "This is a static prompt",
      execute: async () => ({ success: true, content: "" }),
    };

    const tool = buildTool(def);

    expect(tool.prompt).toBeDefined();
    expect(typeof tool.prompt).toBe("function");
    expect(tool.prompt!()).toBe("This is a static prompt");
  });

  it("should pass through prompt function as-is", () => {
    const promptFn = () => "Dynamic prompt";
    const def: ToolDef = {
      name: "PromptFnTool",
      description: "Tool with function prompt",
      parameters: {},
      prompt: promptFn,
      execute: async () => ({ success: true, content: "" }),
    };

    const tool = buildTool(def);

    expect(tool.prompt).toBe(promptFn);
    expect(tool.prompt!()).toBe("Dynamic prompt");
  });

  it("should include formatCompactParams when provided", () => {
    const formatter = () => "compact";
    const def: ToolDef = {
      name: "FormattedTool",
      description: "Tool with compact params",
      parameters: {},
      formatCompactParams: formatter,
      execute: async () => ({ success: true, content: "" }),
    };

    const tool = buildTool(def);

    expect(tool.formatCompactParams).toBe(formatter);
  });

  it("should output ToolPlugin shape", () => {
    const def: ToolDef = {
      name: "ShapeTool",
      description: "Checking shape",
      parameters: { key: { type: "string" } },
      required: ["key"],
      prompt: "Test prompt",
      execute: async () => ({ success: true, content: "ok" }),
    };

    const tool = buildTool(def);

    // Verify it matches ToolPlugin interface
    const _plugin: ToolPlugin = tool;

    expect(_plugin.name).toBe("ShapeTool");
    expect(_plugin.config).toBeDefined();
    expect(typeof _plugin.execute).toBe("function");
    expect(typeof _plugin.prompt).toBe("function");
  });

  it("should execute the tool and return result", async () => {
    const def: ToolDef = {
      name: "ExecTool",
      description: "An executable tool",
      parameters: {
        input: { type: "string" },
      },
      execute: async (args) => ({
        success: true,
        content: `Received: ${args.input}`,
      }),
    };

    const tool = buildTool(def);
    const result = await tool.execute({ input: "hello" }, makeContext());

    expect(result.success).toBe(true);
    expect(result.content).toBe("Received: hello");
  });

  it("should set additionalProperties to true when specified", () => {
    const def: ToolDef = {
      name: "OpenTool",
      description: "Tool with additional properties",
      parameters: {
        name: { type: "string" },
      },
      additionalProperties: true,
      execute: async () => ({ success: true, content: "" }),
    };

    const tool = buildTool(def);

    expect(tool.config.function.parameters!.additionalProperties).toBe(true);
  });

  it("should default additionalProperties to false", () => {
    const def: ToolDef = {
      name: "ClosedTool",
      description: "Tool without additional properties",
      parameters: {},
      execute: async () => ({ success: true, content: "" }),
    };

    const tool = buildTool(def);

    expect(tool.config.function.parameters!.additionalProperties).toBe(false);
  });
});
