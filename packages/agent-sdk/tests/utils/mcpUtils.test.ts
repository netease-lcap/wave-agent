import { describe, it, expect } from "vitest";
import { mcpToolToOpenAITool } from "../../src/utils/mcpUtils.js";
import { McpTool } from "../../src/types/index.js";

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
});
