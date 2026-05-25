import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  mcpToolToOpenAITool,
  createMcpToolPlugin,
} from "../../src/utils/mcpUtils.js";
import { McpTool } from "../../src/types/index.js";
import type { ToolContext } from "../../src/tools/types.js";
import * as fs from "fs";

// Mock fs
vi.mock("fs", async () => {
  const actual = await vi.importActual("fs");
  return {
    ...actual,
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  };
});

// Mock os
vi.mock("os", async () => {
  const actual = await vi.importActual("os");
  return {
    ...actual,
    tmpdir: vi.fn().mockReturnValue("/tmp"),
  };
});

// Mock logger
vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("mcpUtils", () => {
  describe("cleanSchema", () => {
    it("should convert array type to single type and nullable: true", () => {
      const mcpTool: McpTool = {
        name: "test_tool",
        description: "A test tool",
        inputSchema: {
          type: "object",
          properties: {
            value: {
              type: ["string", "null"],
              description: "A nullable string",
            },
          },
        },
      };

      const result = mcpToolToOpenAITool(mcpTool, "test_server");
      const parameters = result.function.parameters as Record<string, unknown>;
      const properties = parameters.properties as Record<
        string,
        Record<string, unknown>
      >;
      const value = properties.value as Record<string, unknown>;

      expect(value.type).toBe("string");
      expect(value.nullable).toBe(true);
    });

    it("should handle multiple non-null types by picking the first one", () => {
      const mcpTool: McpTool = {
        name: "test_tool",
        description: "A test tool",
        inputSchema: {
          type: "object",
          properties: {
            value: {
              type: ["number", "string"],
            },
          },
        },
      };

      const result = mcpToolToOpenAITool(mcpTool, "test_server");
      const parameters = result.function.parameters as Record<string, unknown>;
      const properties = parameters.properties as Record<
        string,
        Record<string, unknown>
      >;
      const value = properties.value as Record<string, unknown>;

      expect(value.type).toBe("number");
      expect(value.nullable).toBeUndefined();
    });

    it("should remove unsupported fields like $schema and exclusiveMinimum", () => {
      const mcpTool: McpTool = {
        name: "test_tool",
        description: "A test tool",
        inputSchema: {
          $schema: "http://json-schema.org/draft-07/schema#",
          type: "object",
          properties: {
            count: {
              type: "number",
              exclusiveMinimum: 0,
            },
          },
        },
      };

      const result = mcpToolToOpenAITool(mcpTool, "test_server");
      const parameters = result.function.parameters as Record<string, unknown>;
      const properties = parameters.properties as Record<
        string,
        Record<string, unknown>
      >;
      const count = properties.count as Record<string, unknown>;

      expect(parameters.$schema).toBeUndefined();
      expect(count.exclusiveMinimum).toBeUndefined();
      expect(count.type).toBe("number");
    });
  });

  describe("createMcpToolPlugin", () => {
    const mcpTool: McpTool = {
      name: "test_tool",
      description: "A test tool",
      inputSchema: {
        type: "object",
        properties: {},
      },
    };

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("should pass through small results unchanged", async () => {
      const smallContent = "small result";
      const executeTool = vi.fn().mockResolvedValue({
        success: true,
        content: smallContent,
      });

      const plugin = createMcpToolPlugin(mcpTool, "test_server", executeTool);
      const result = await plugin.execute(
        {},
        undefined as unknown as ToolContext,
      );

      expect(result.success).toBe(true);
      expect(result.content).toBe(smallContent);
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it("should wrap large results in <persisted-output>", async () => {
      const largeContent = "a".repeat(50001);
      const executeTool = vi.fn().mockResolvedValue({
        success: true,
        content: largeContent,
      });

      const plugin = createMcpToolPlugin(mcpTool, "test_server", executeTool);
      const result = await plugin.execute(
        {},
        undefined as unknown as ToolContext,
      );

      expect(result.success).toBe(true);
      expect(result.content).toContain("<persisted-output>");
      expect(result.content).toContain("Full output saved to:");
      expect(result.content).toContain("</persisted-output>");
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining("wave-tool-results"),
        largeContent,
        "utf8",
      );
    });

    it("should preserve images in results", async () => {
      const largeContent = "b".repeat(50001);
      const images = [{ data: "base64imagedata", mediaType: "image/png" }];
      const executeTool = vi.fn().mockResolvedValue({
        success: true,
        content: largeContent,
        images,
      });

      const plugin = createMcpToolPlugin(mcpTool, "test_server", executeTool);
      const result = await plugin.execute(
        {},
        undefined as unknown as ToolContext,
      );

      expect(result.success).toBe(true);
      expect(result.content).toContain("<persisted-output>");
      expect(result.images).toEqual(images);
    });
  });
});
