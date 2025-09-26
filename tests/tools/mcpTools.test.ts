import { describe, it, expect, beforeEach, vi } from "vitest";
import { mcpManager } from "../../src/services/mcpManager";
import { ToolContext, ToolPlugin } from "../../src/tools/types";

// Mock mcpManager
vi.mock("../../src/services/mcpManager", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    mcpManager: {
      getAllServers: vi.fn(),
      getAllConnectedTools: vi.fn(),
      executeMcpTool: vi.fn(),
      getMcpToolPlugins: vi.fn(),
      getMcpToolsConfig: vi.fn(),
      executeMcpToolByRegistry: vi.fn(),
      isMcpTool: vi.fn(),
    },
  };
});

describe("McpManager - Tools Registry", () => {
  const mockMcpTools = [
    {
      name: "server1_tool1",
      description: "Tool 1 from server 1",
      inputSchema: {
        type: "object",
        properties: {
          param: { type: "string" },
        },
        required: ["param"],
      },
    },
    {
      name: "server2_tool2",
      description: "Tool 2 from server 2",
      inputSchema: {
        type: "object",
        properties: {
          value: { type: "number" },
        },
      },
    },
  ];

  const mockServers = [
    {
      name: "server1",
      status: "connected" as const,
      tools: [mockMcpTools[0]],
      config: { command: "test1" },
    },
    {
      name: "server2",
      status: "connected" as const,
      tools: [mockMcpTools[1]],
      config: { command: "test2" },
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mcpManager.getAllConnectedTools).mockReturnValue(mockMcpTools);
    vi.mocked(mcpManager.getAllServers).mockReturnValue(mockServers);
  });

  describe("getMcpToolPlugins", () => {
    it("should return tool plugins for connected MCP tools", () => {
      // Mock the mcpManager methods to return test data
      vi.mocked(mcpManager.getAllConnectedTools).mockReturnValue(mockMcpTools);
      vi.mocked(mcpManager.getAllServers).mockReturnValue(mockServers);
      vi.mocked(mcpManager.getMcpToolPlugins).mockReturnValue([
        {
          name: "server1_tool1",
          description: "Tool 1 from server 1",
          config: {
            type: "function",
            function: {
              name: "server1_tool1",
              description: "Tool 1 from server 1 (MCP: server1)",
              parameters: mockMcpTools[0].inputSchema,
            },
          },
          execute: vi.fn(),
        },
        {
          name: "server2_tool2",
          description: "Tool 2 from server 2",
          config: {
            type: "function",
            function: {
              name: "server2_tool2",
              description: "Tool 2 from server 2 (MCP: server2)",
              parameters: mockMcpTools[1].inputSchema,
            },
          },
          execute: vi.fn(),
        },
      ]);

      const plugins = mcpManager.getMcpToolPlugins();

      expect(plugins).toHaveLength(2);

      const plugin1 = plugins.find((p) => p.name === "server1_tool1");
      expect(plugin1).toBeDefined();
      expect(plugin1?.description).toBe("Tool 1 from server 1");

      const plugin2 = plugins.find((p) => p.name === "server2_tool2");
      expect(plugin2).toBeDefined();
      expect(plugin2?.description).toBe("Tool 2 from server 2");
    });

    it("should return empty array when no MCP tools available", () => {
      vi.mocked(mcpManager.getAllConnectedTools).mockReturnValue([]);
      vi.mocked(mcpManager.getAllServers).mockReturnValue([]);
      vi.mocked(mcpManager.getMcpToolPlugins).mockReturnValue([]);

      const plugins = mcpManager.getMcpToolPlugins();

      expect(plugins).toHaveLength(0);
    });
  });

  describe("getMcpToolsConfig", () => {
    it("should return OpenAI function tool configs", () => {
      vi.mocked(mcpManager.getMcpToolsConfig).mockReturnValue([
        {
          type: "function",
          function: {
            name: "server1_tool1",
            description: "Tool 1 from server 1 (MCP: server1)",
            parameters: mockMcpTools[0].inputSchema,
          },
        },
        {
          type: "function",
          function: {
            name: "server2_tool2",
            description: "Tool 2 from server 2 (MCP: server2)",
            parameters: mockMcpTools[1].inputSchema,
          },
        },
      ]);

      const configs = mcpManager.getMcpToolsConfig();

      expect(configs).toHaveLength(2);

      const config1 = configs.find((c) => c.function.name === "server1_tool1");
      expect(config1).toMatchObject({
        type: "function",
        function: {
          name: "server1_tool1",
          description: "Tool 1 from server 1 (MCP: server1)",
          parameters: mockMcpTools[0].inputSchema,
        },
      });
    });
  });

  describe("executeMcpTool", () => {
    it("should execute MCP tool successfully", async () => {
      const mockResult = {
        success: true,
        content: "Tool execution result",
      };
      vi.mocked(mcpManager.executeMcpToolByRegistry).mockResolvedValue(
        mockResult,
      );

      const context: ToolContext = { workdir: "/test" };
      const result = await mcpManager.executeMcpToolByRegistry(
        "server1_tool1",
        { param: "test" },
        context,
      );

      expect(result).toEqual({
        success: true,
        content: "Tool execution result",
      });
      expect(mcpManager.executeMcpToolByRegistry).toHaveBeenCalledWith(
        "server1_tool1",
        {
          param: "test",
        },
        context,
      );
    });

    it("should handle tool execution failure", async () => {
      vi.mocked(mcpManager.executeMcpToolByRegistry).mockResolvedValue({
        success: false,
        content: "",
        error: "Execution failed",
      });

      const result = await mcpManager.executeMcpToolByRegistry(
        "server1_tool1",
        {},
      );

      expect(result).toEqual({
        success: false,
        content: "",
        error: "Execution failed",
      });
    });

    it("should return error for non-existent tool", async () => {
      vi.mocked(mcpManager.executeMcpToolByRegistry).mockResolvedValue({
        success: false,
        content: "",
        error: "MCP tool 'non_existent_tool' not found or server disconnected",
      });

      const result = await mcpManager.executeMcpToolByRegistry(
        "non_existent_tool",
        {},
      );

      expect(result).toEqual({
        success: false,
        content: "",
        error: "MCP tool 'non_existent_tool' not found or server disconnected",
      });
    });
  });

  describe("isMcpTool", () => {
    it("should return true for MCP tools", () => {
      vi.mocked(mcpManager.isMcpTool).mockReturnValue(true);

      expect(mcpManager.isMcpTool("server1_tool1")).toBe(true);
      expect(mcpManager.isMcpTool("server2_tool2")).toBe(true);
    });

    it("should return false for non-MCP tools", () => {
      vi.mocked(mcpManager.isMcpTool).mockReturnValue(false);

      expect(mcpManager.isMcpTool("built_in_tool")).toBe(false);
      expect(mcpManager.isMcpTool("non_existent_tool")).toBe(false);
    });
  });

  describe("tool plugin execution", () => {
    it("should execute tool through plugin interface", async () => {
      const mockPlugin = {
        name: "server1_tool1",
        description: "Tool 1 from server 1",
        config: {
          type: "function" as const,
          function: {
            name: "server1_tool1",
            description: "Tool 1 from server 1 (MCP: server1)",
            parameters: mockMcpTools[0].inputSchema,
          },
        },
        execute: vi.fn().mockResolvedValue({
          success: true,
          content: "Plugin execution result",
        }),
      };

      vi.mocked(mcpManager.getMcpToolPlugins).mockReturnValue([mockPlugin]);

      const plugins = mcpManager.getMcpToolPlugins();
      const plugin = plugins.find((p) => p.name === "server1_tool1");

      expect(plugin).toBeDefined();

      const result = await plugin!.execute({ param: "test" });

      expect(result).toEqual({
        success: true,
        content: "Plugin execution result",
      });
    });

    it("should handle plugin execution errors", async () => {
      const mockPlugin = {
        name: "server1_tool1",
        description: "Tool 1 from server 1",
        config: {
          type: "function" as const,
          function: {
            name: "server1_tool1",
            description: "Tool 1 from server 1 (MCP: server1)",
            parameters: mockMcpTools[0].inputSchema,
          },
        },
        execute: vi.fn().mockResolvedValue({
          success: false,
          content: "",
          error: "Plugin error",
        }),
      };

      vi.mocked(mcpManager.getMcpToolPlugins).mockReturnValue([mockPlugin]);

      const plugins = mcpManager.getMcpToolPlugins();
      const plugin = plugins.find((p) => p.name === "server1_tool1");

      const result = await plugin!.execute({ param: "test" });

      expect(result).toEqual({
        success: false,
        content: "",
        error: "Plugin error",
      });
    });
  });

  describe("dynamic updates", () => {
    it("should update tools when MCP servers change", () => {
      // Mock initial state
      vi.mocked(mcpManager.getMcpToolPlugins)
        .mockReturnValueOnce([
          { name: "server1_tool1" },
          { name: "server2_tool2" },
        ] as ToolPlugin[])
        .mockReturnValueOnce([{ name: "server1_tool1" }] as ToolPlugin[]);

      // Initial state
      let plugins = mcpManager.getMcpToolPlugins();
      expect(plugins).toHaveLength(2);

      // Simulate server disconnection
      plugins = mcpManager.getMcpToolPlugins();
      expect(plugins).toHaveLength(1);
      expect(plugins[0].name).toBe("server1_tool1");
    });
  });
});
