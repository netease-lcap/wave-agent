import { ChatCompletionFunctionTool } from "openai/resources.js";
import type { ToolPlugin, ToolResult, ToolContext } from "../tools/types.js";
import type { McpTool, McpServerStatus } from "../types.js";

/**
 * Convert MCP tool to OpenAI function tool format
 */
export function mcpToolToOpenAITool(
  mcpTool: McpTool,
  serverName: string,
): ChatCompletionFunctionTool {
  // Remove $schema field if it exists, as OpenAI API doesn't accept it
  const cleanInputSchema = { ...mcpTool.inputSchema };
  delete cleanInputSchema.$schema;

  return {
    type: "function",
    function: {
      name: mcpTool.name,
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
  return {
    name: mcpTool.name,
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
        const result = await executeTool(mcpTool.name, args);
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
