import { describe, it, expect } from "vitest";
import {
  isDeferredTool,
  getDeferredToolNames,
} from "../../src/utils/isDeferredTool.js";
import type { ToolPlugin, ToolContext } from "../../src/tools/types.js";
import { toolSearchTool } from "../../src/tools/toolSearchTool.js";

function makeContext(toolManager?: { list: () => ToolPlugin[] }): ToolContext {
  return {
    workdir: "/tmp",
    taskManager:
      {} as unknown as import("@/services/taskManager.js").TaskManager,
    ...(toolManager ? { toolManager } : {}),
  } as ToolContext;
}

function makeTool(overrides: Partial<ToolPlugin>): ToolPlugin {
  return {
    name: "TestTool",
    config: {
      type: "function",
      function: {
        name: "TestTool",
        description: "A test tool",
        parameters: { type: "object", properties: {} },
      },
    },
    execute: async () => ({ success: true, content: "" }),
    ...overrides,
  };
}

describe("isDeferredTool", () => {
  it("should return false for a regular tool", () => {
    expect(isDeferredTool(makeTool({}))).toBe(false);
  });

  it("should return true when shouldDefer is true", () => {
    expect(isDeferredTool(makeTool({ shouldDefer: true }))).toBe(true);
  });

  it("should return true for MCP tools", () => {
    expect(isDeferredTool(makeTool({ isMcp: true }))).toBe(true);
  });

  it("should return false when alwaysLoad is true (override)", () => {
    expect(
      isDeferredTool(makeTool({ shouldDefer: true, alwaysLoad: true })),
    ).toBe(false);
    expect(isDeferredTool(makeTool({ isMcp: true, alwaysLoad: true }))).toBe(
      false,
    );
  });

  it("should return false for ToolSearch itself", () => {
    expect(isDeferredTool(toolSearchTool)).toBe(false);
  });
});

describe("getDeferredToolNames", () => {
  it("should return names of deferred tools", () => {
    const tools = [
      makeTool({ name: "A", shouldDefer: true }),
      makeTool({ name: "B" }),
      makeTool({ name: "C", isMcp: true }),
    ];
    expect(getDeferredToolNames(tools)).toEqual(["A", "C"]);
  });

  it("should return empty array when no deferred tools", () => {
    const tools = [makeTool({ name: "A" }), makeTool({ name: "B" })];
    expect(getDeferredToolNames(tools)).toEqual([]);
  });
});

describe("toolSearchTool", () => {
  it("should not be deferred", () => {
    expect(toolSearchTool.shouldDefer).toBe(false);
  });

  it("should return tool schemas for select: query", async () => {
    const context = makeContext({
      list: () => [
        makeTool({
          name: "DeferredA",
          shouldDefer: true,
          config: {
            type: "function",
            function: {
              name: "DeferredA",
              description: "Tool A description",
              parameters: {
                type: "object",
                properties: { arg1: { type: "string" } },
              },
            },
          },
        }),
        makeTool({
          name: "DeferredB",
          shouldDefer: true,
          config: {
            type: "function",
            function: {
              name: "DeferredB",
              description: "Tool B description",
              parameters: { type: "object", properties: {} },
            },
          },
        }),
      ],
    });

    const result = await toolSearchTool.execute(
      { query: "select:DeferredA" },
      context,
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("DeferredA");
    expect(result.content).toContain("Tool A description");
    expect(result.content).toContain('"arg1"');
    expect(result.shortResult).toContain("DeferredA");
  });

  it("should return multiple tools for comma-separated select", async () => {
    const context = makeContext({
      list: () => [
        makeTool({
          name: "Tool1",
          shouldDefer: true,
          config: {
            type: "function",
            function: { name: "Tool1", description: "desc1", parameters: {} },
          },
        }),
        makeTool({
          name: "Tool2",
          shouldDefer: true,
          config: {
            type: "function",
            function: { name: "Tool2", description: "desc2", parameters: {} },
          },
        }),
      ],
    });

    const result = await toolSearchTool.execute(
      { query: "select:Tool1,Tool2" },
      context,
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("Tool1");
    expect(result.content).toContain("Tool2");
  });

  it("should error for non-existent tool in select", async () => {
    const context = makeContext({ list: () => [] });

    const result = await toolSearchTool.execute(
      { query: "select:NonExistent" },
      context,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("NonExistent");
  });

  it("should find tools by keyword search", async () => {
    const context = makeContext({
      list: () => [
        makeTool({
          name: "CronCreate",
          shouldDefer: true,
          config: {
            type: "function",
            function: {
              name: "CronCreate",
              description: "Schedule a recurring prompt",
              parameters: {},
            },
          },
        }),
        makeTool({
          name: "WebFetch",
          shouldDefer: true,
          config: {
            type: "function",
            function: {
              name: "WebFetch",
              description: "Fetch web content",
              parameters: {},
            },
          },
        }),
      ],
    });

    const result = await toolSearchTool.execute({ query: "schedule" }, context);

    expect(result.success).toBe(true);
    expect(result.content).toContain("CronCreate");
    expect(result.content).not.toContain("WebFetch");
  });

  it("should error when no keyword matches found", async () => {
    const context = makeContext({
      list: () => [
        makeTool({
          name: "ToolA",
          shouldDefer: true,
          config: {
            type: "function",
            function: { name: "ToolA", description: "desc", parameters: {} },
          },
        }),
      ],
    });

    const result = await toolSearchTool.execute(
      { query: "zzzznotfound" },
      context,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("zzzznotfound");
    expect(result.error).toContain("ToolA"); // lists available tools
  });

  it("should handle missing toolManager in context", async () => {
    const context = makeContext();
    const result = await toolSearchTool.execute(
      { query: "select:Test" },
      context,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("ToolManager not available");
  });

  it("should handle exact match fast path in keyword search", async () => {
    const context = makeContext({
      list: () => [
        makeTool({
          name: "ExactTool",
          shouldDefer: true,
          config: {
            type: "function",
            function: {
              name: "ExactTool",
              description: "An exact tool",
              parameters: {},
            },
          },
        }),
      ],
    });

    const result = await toolSearchTool.execute(
      { query: "ExactTool" },
      context,
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("ExactTool");
  });
});
