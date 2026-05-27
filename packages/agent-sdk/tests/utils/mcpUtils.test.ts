import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs";
import {
  mcpToolToOpenAITool,
  createMcpToolPlugin,
  findToolServer,
} from "../../src/utils/mcpUtils.js";
import type { McpTool, McpServerStatus } from "../../src/types/index.js";
import type { ToolContext } from "../../src/tools/types.js";
import { DEFAULT_MAX_RESULT_SIZE_CHARS } from "../../src/constants/toolLimits.js";

// Mock fs for persistence tests
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
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("mcpToolToOpenAITool", () => {
    it("should convert MCP tool to OpenAI format with prefixed name", () => {
      const mcpTool: McpTool = {
        name: "search",
        description: "Search for items",
        inputSchema: {
          type: "object",
          properties: { query: { type: "string" } },
        },
      };

      const result = mcpToolToOpenAITool(mcpTool, "myserver");

      expect(result).toEqual({
        type: "function",
        function: {
          name: "mcp__myserver__search",
          description: "Search for items (MCP: myserver)",
          parameters: {
            type: "object",
            properties: { query: { type: "string" } },
          },
        },
      });
    });
  });

  describe("createMcpToolPlugin", () => {
    const mcpTool: McpTool = {
      name: "test_tool",
      description: "A test tool",
      inputSchema: { type: "object", properties: {} },
    };

    it("should pass through small results unchanged", async () => {
      const executeTool = vi.fn().mockResolvedValue({
        success: true,
        content: "small result",
      });

      const plugin = createMcpToolPlugin(mcpTool, "myserver", executeTool);
      const result = await plugin.execute(
        {},
        undefined as unknown as ToolContext,
      );

      expect(result.success).toBe(true);
      expect(result.content).toBe("small result");
    });

    it("should wrap large results in <persisted-output>", async () => {
      const largeContent = "x".repeat(DEFAULT_MAX_RESULT_SIZE_CHARS + 1000);
      const executeTool = vi.fn().mockResolvedValue({
        success: true,
        content: largeContent,
      });

      const plugin = createMcpToolPlugin(mcpTool, "myserver", executeTool);
      const result = await plugin.execute(
        {},
        undefined as unknown as ToolContext,
      );

      expect(result.success).toBe(true);
      expect(result.content).toContain("<persisted-output>");
      expect(result.content).toContain(
        "/tmp/wave-tool-results/mcp_myserver_test_tool_",
      );
      expect(result.content).toContain("</persisted-output>");
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining("mcp_myserver_test_tool_"),
        largeContent,
        "utf8",
      );
    });

    it("should preserve images in results", async () => {
      const images = [{ data: "base64data", mediaType: "image/png" }];
      const executeTool = vi.fn().mockResolvedValue({
        success: true,
        content: "result with image",
        images,
      });

      const plugin = createMcpToolPlugin(mcpTool, "myserver", executeTool);
      const result = await plugin.execute(
        {},
        undefined as unknown as ToolContext,
      );

      expect(result.success).toBe(true);
      expect(result.content).toBe("result with image");
      expect(result.images).toEqual(images);
    });

    it("should handle tool execution errors", async () => {
      const executeTool = vi.fn().mockRejectedValue(new Error("tool failed"));

      const plugin = createMcpToolPlugin(mcpTool, "myserver", executeTool);
      const result = await plugin.execute(
        {},
        undefined as unknown as ToolContext,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("tool failed");
    });

    it("should use default content when result content is empty", async () => {
      const executeTool = vi.fn().mockResolvedValue({
        success: true,
        content: "",
      });

      const plugin = createMcpToolPlugin(mcpTool, "myserver", executeTool);
      const result = await plugin.execute(
        {},
        undefined as unknown as ToolContext,
      );

      expect(result.success).toBe(true);
      expect(result.content).toBe("Executed test_tool");
    });
  });

  describe("findToolServer", () => {
    it("should find the server that owns a tool", () => {
      const servers: McpServerStatus[] = [
        {
          name: "server1",
          status: "connected",
          config: { command: "test1" },
          tools: [{ name: "tool_a" } as McpTool],
        },
        {
          name: "server2",
          status: "connected",
          config: { command: "test2" },
          tools: [{ name: "tool_b" } as McpTool],
        },
      ];

      expect(findToolServer("tool_a", servers)?.name).toBe("server1");
      expect(findToolServer("tool_b", servers)?.name).toBe("server2");
    });

    it("should return undefined for unknown tool", () => {
      const servers: McpServerStatus[] = [
        {
          name: "server1",
          status: "connected",
          config: { command: "test1" },
          tools: [{ name: "tool_a" } as McpTool],
        },
      ];

      expect(findToolServer("tool_c", servers)).toBeUndefined();
    });

    it("should skip disconnected servers", () => {
      const servers: McpServerStatus[] = [
        {
          name: "server1",
          status: "disconnected",
          config: { command: "test1" },
          tools: [{ name: "tool_a" } as McpTool],
        },
      ];

      expect(findToolServer("tool_a", servers)).toBeUndefined();
    });
  });
});
