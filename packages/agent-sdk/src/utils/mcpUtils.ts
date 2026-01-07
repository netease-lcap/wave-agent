import { ChatCompletionFunctionTool } from "openai/resources.js";
import type { ToolPlugin, ToolResult, ToolContext } from "../tools/types.js";
import type { McpTool, McpServerStatus } from "../types/index.js";

/**
 * Recursively clean schema to remove unsupported fields
 */
function cleanSchema(schema: unknown): unknown {
  if (typeof schema !== "object" || schema === null) {
    return schema;
  }

  if (Array.isArray(schema)) {
    return schema.map(cleanSchema);
  }

  const newSchema: Record<string, unknown> = {};
  const obj = schema as Record<string, unknown>;

  for (const key in obj) {
    // Remove $schema as OpenAI API doesn't accept it
    // Remove exclusiveMinimum/exclusiveMaximum as some models (e.g. Gemini) don't support them
    if (
      key === "$schema" ||
      key === "exclusiveMinimum" ||
      key === "exclusiveMaximum"
    ) {
      continue;
    }
    newSchema[key] = cleanSchema(obj[key]);
  }
  return newSchema;
}

/**
 * Convert MCP tool to OpenAI function tool format
 */
export function mcpToolToOpenAITool(
  mcpTool: McpTool,
  serverName: string,
): ChatCompletionFunctionTool {
  const cleanInputSchema = cleanSchema(mcpTool.inputSchema) as Record<
    string,
    unknown
  >;

  const prefixedName = `mcp__${serverName}__${mcpTool.name}`;

  return {
    type: "function",
    function: {
      name: prefixedName,
      description: `${mcpTool.description || `Tool from MCP server ${serverName}`} (MCP: ${serverName})`,
      parameters: cleanInputSchema,
    },
  };
}

/**
 * Create a tool plugin wrapper for an MCP tool
 */
export function createMcpToolPlugin(
  mcpTool: McpTool,
  serverName: string,
  executeTool: (
    name: string,
    args: Record<string, unknown>,
  ) => Promise<{
    success: boolean;
    content: string;
    serverName?: string;
    images?: Array<{ data: string; mediaType?: string }>;
  }>,
): ToolPlugin {
  const prefixedName = `mcp__${serverName}__${mcpTool.name}`;
  return {
    name: prefixedName,
    config: mcpToolToOpenAITool(mcpTool, serverName),
    async execute(
      args: Record<string, unknown>,
      context?: ToolContext,
    ): Promise<ToolResult> {
      try {
        // Context is available for future use when MCP tools need execution context
        if (context) {
          // Future: Could pass working directory or other context to MCP tools
        }
        const result = await executeTool(prefixedName, args);
        return {
          success: true,
          content: result.content || `Executed ${mcpTool.name}`,
        };
      } catch (error) {
        return {
          success: false,
          content: "",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

/**
 * Find which server a tool belongs to
 */
export function findToolServer(
  toolName: string,
  servers: McpServerStatus[],
): McpServerStatus | undefined {
  return servers.find(
    (s) =>
      s.status === "connected" && s.tools?.some((t) => t.name === toolName),
  );
}
