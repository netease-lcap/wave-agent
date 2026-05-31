import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { McpManager } from "../../src/managers/mcpManager.js";
import type { McpServerConfig, Logger } from "../../src/types/index.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// Mock interfaces
interface MockClient {
  connect: ReturnType<typeof vi.fn>;
  listTools: ReturnType<typeof vi.fn>;
  callTool: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

interface MockTransport {
  close: ReturnType<typeof vi.fn>;
  onerror: null;
  onclose: null;
}

// Mock the MCP SDK
vi.mock("@modelcontextprotocol/sdk/client/index.js");
vi.mock("@modelcontextprotocol/sdk/client/stdio.js");
vi.mock("fs");

describe("McpManager", () => {
  let mcpManager: McpManager;

  const mockConfig = {
    mcpServers: {
      "test-server": {
        command: "npx",
        args: ["test-mcp-server"],
        env: { TEST_VAR: "value" },
      },
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Mock console.error to prevent stderr output in tests
    vi.spyOn(console, "error").mockImplementation(() => {});
    // Initialize mcpManager with test directory
    mcpManager = new McpManager();
    mcpManager.initialize("/test/workdir");
  });

  afterEach(async () => {
    await mcpManager.cleanup();
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("should accept logger parameter", () => {
      const mockLogger: Logger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      };

      const manager = new McpManager({ logger: mockLogger });
      expect(manager).toBeInstanceOf(McpManager);
    });

    it("should work without logger parameter", () => {
      const manager = new McpManager();
      expect(manager).toBeInstanceOf(McpManager);
    });

    it("should accept callbacks parameter", () => {
      const mockCallback = vi.fn();
      const manager = new McpManager({
        callbacks: { onServersChange: mockCallback },
      });
      expect(manager).toBeInstanceOf(McpManager);
    });

    it("should accept mcpServers parameter", () => {
      const manager = new McpManager({
        mcpServers: {
          "my-server": { command: "npx", args: ["my-mcp-server"] },
        },
      });
      expect(manager).toBeInstanceOf(McpManager);
    });
  });

  describe("mcpServers constructor option", () => {
    it("should register constructor-provided servers on initialize", async () => {
      const { promises: fs } = await import("fs");
      vi.mocked(fs.readFile).mockRejectedValue(new Error("File not found"));

      const manager = new McpManager({
        mcpServers: {
          "ctor-server": { command: "npx", args: ["ctor-mcp"] },
        },
      });
      await manager.initialize("/test/workdir", false);

      const servers = manager.getAllServers();
      expect(servers).toHaveLength(1);
      expect(servers[0]).toMatchObject({
        name: "ctor-server",
        status: "disconnected",
      });
      expect(servers[0].config.command).toBe("npx");

      await manager.cleanup();
    });

    it("should override .mcp.json for same server names", async () => {
      const { promises: fs } = await import("fs");
      const fileConfig = {
        mcpServers: {
          "shared-server": { command: "from-file", args: ["file-arg"] },
          "file-only": { command: "file-cmd" },
        },
      };
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(fileConfig));

      const manager = new McpManager({
        mcpServers: {
          "shared-server": { command: "from-ctor", args: ["ctor-arg"] },
        },
      });
      await manager.initialize("/test/workdir", true);

      const shared = manager.getServer("shared-server");
      expect(shared?.config.command).toBe("from-ctor");
      expect(shared?.config.args).toEqual(["ctor-arg"]);

      const fileOnly = manager.getServer("file-only");
      expect(fileOnly?.config.command).toBe("file-cmd");

      await manager.cleanup();
    });

    it("should expand env vars in constructor-provided config", async () => {
      process.env.TEST_MCP_CMD = "resolved-cmd";
      process.env.TEST_MCP_ARG = "resolved-arg";

      const manager = new McpManager({
        mcpServers: {
          "env-server": {
            command: "${TEST_MCP_CMD}",
            args: ["${TEST_MCP_ARG}"],
            env: { KEY: "${TEST_MCP_CMD}" },
          },
        },
      });
      await manager.initialize("/test/workdir", false);

      const server = manager.getServer("env-server");
      expect(server?.config.command).toBe("resolved-cmd");
      expect(server?.config.args).toEqual(["resolved-arg"]);
      expect(server?.config.env?.KEY).toBe("resolved-cmd");

      delete process.env.TEST_MCP_CMD;
      delete process.env.TEST_MCP_ARG;
      await manager.cleanup();
    });
  });

  describe("loadConfig", () => {
    it("should load configuration from .mcp.json", async () => {
      const { promises: fs } = await import("fs");
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockConfig));

      const config = await mcpManager.loadConfig();

      expect(config).toEqual(mockConfig);
      expect(fs.readFile).toHaveBeenCalledWith(
        expect.stringContaining(".mcp.json"),
        "utf-8",
      );
    });

    it("should return null if config file doesn't exist", async () => {
      const { promises: fs } = await import("fs");
      vi.mocked(fs.readFile).mockRejectedValue(new Error("File not found"));

      const config = await mcpManager.loadConfig();

      expect(config).toBeNull();
    });

    it("should initialize server status after loading config", async () => {
      const { promises: fs } = await import("fs");
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockConfig));

      await mcpManager.loadConfig();
      const servers = mcpManager.getAllServers();

      expect(servers).toHaveLength(1);
      expect(servers[0]).toMatchObject({
        name: "test-server",
        config: mockConfig.mcpServers["test-server"],
        status: "disconnected",
      });
    });
  });

  describe("saveConfig", () => {
    it("should save configuration to .mcp.json", async () => {
      const { promises: fs } = await import("fs");
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      const result = await mcpManager.saveConfig(mockConfig);

      expect(result).toBe(true);
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining(".mcp.json"),
        JSON.stringify(mockConfig, null, 2),
      );
    });

    it("should return false if save fails", async () => {
      const { promises: fs } = await import("fs");
      vi.mocked(fs.writeFile).mockRejectedValue(new Error("Write error"));

      const result = await mcpManager.saveConfig(mockConfig);

      expect(result).toBe(false);
    });
  });

  describe("server management", () => {
    beforeEach(async () => {
      const { promises: fs } = await import("fs");
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockConfig));
      await mcpManager.loadConfig();
    });

    it("should add a new server", () => {
      const newConfig: McpServerConfig = {
        command: "npx",
        args: ["new-server"],
      };

      const result = mcpManager.addServer("new-server", newConfig);

      expect(result).toBe(true);
      const server = mcpManager.getServer("new-server");
      expect(server).toMatchObject({
        name: "new-server",
        config: newConfig,
        status: "disconnected",
      });
    });

    it("should not add duplicate server", () => {
      const result = mcpManager.addServer(
        "test-server",
        mockConfig.mcpServers["test-server"],
      );

      expect(result).toBe(false);
    });

    it("should remove a server", () => {
      const result = mcpManager.removeServer("test-server");

      expect(result).toBe(true);
      const server = mcpManager.getServer("test-server");
      expect(server).toBeUndefined();
    });

    it("should update server status", () => {
      mcpManager.updateServerStatus("test-server", {
        status: "connected",
        toolCount: 5,
      });

      const server = mcpManager.getServer("test-server");
      expect(server?.status).toBe("connected");
      expect(server?.toolCount).toBe(5);
    });
  });

  describe("connectServer", () => {
    let mockClient: MockClient;
    let mockTransport: MockTransport;

    beforeEach(async () => {
      const { promises: fs } = await import("fs");
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockConfig));
      await mcpManager.loadConfig();

      mockClient = {
        connect: vi.fn().mockResolvedValue(undefined),
        listTools: vi.fn().mockResolvedValue({
          tools: [
            {
              name: "test_tool",
              description: "A test tool",
              inputSchema: { type: "object" },
            },
          ],
        }),
        callTool: vi.fn(),
        close: vi.fn().mockResolvedValue(undefined),
      };

      mockTransport = {
        close: vi.fn().mockResolvedValue(undefined),
        onerror: null,
        onclose: null,
      };

      vi.mocked(Client).mockImplementation(() => mockClient as never);
      vi.mocked(StdioClientTransport).mockImplementation(
        () => mockTransport as never,
      );
    });

    it("should connect to MCP server successfully", async () => {
      const result = await mcpManager.connectServer("test-server");

      expect(result).toBe(true);
      expect(Client).toHaveBeenCalledWith(
        { name: "wave-code", version: "1.0.0" },
        { capabilities: { tools: {} } },
      );
      expect(StdioClientTransport).toHaveBeenCalledWith({
        command: "npx",
        args: ["test-mcp-server"],
        env: { TEST_VAR: "value" },
        cwd: "/test/workdir",
      });
      expect(mockClient.connect).toHaveBeenCalledWith(mockTransport);

      const server = mcpManager.getServer("test-server");
      expect(server?.status).toBe("connected");
      expect(server?.toolCount).toBe(1);
    });

    it("should handle connection failure", async () => {
      mockClient.connect.mockRejectedValue(new Error("Connection failed"));

      const result = await mcpManager.connectServer("test-server");

      expect(result).toBe(false);
      const server = mcpManager.getServer("test-server");
      expect(server?.status).toBe("error");
      expect(server?.error).toBe("Connection failed");
    });

    it("should return true if already connected", async () => {
      // First connection
      await mcpManager.connectServer("test-server");
      vi.clearAllMocks();

      // Second connection attempt
      const result = await mcpManager.connectServer("test-server");

      expect(result).toBe(true);
      expect(Client).not.toHaveBeenCalled();
    });

    it("should return false for non-existent server", async () => {
      const result = await mcpManager.connectServer("non-existent");

      expect(result).toBe(false);
    });
  });

  describe("disconnectServer", () => {
    let mockClient: MockClient;
    let mockTransport: MockTransport;

    beforeEach(async () => {
      const { promises: fs } = await import("fs");
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockConfig));
      await mcpManager.loadConfig();

      mockClient = {
        connect: vi.fn().mockResolvedValue(undefined),
        listTools: vi.fn().mockResolvedValue({ tools: [] }),
        callTool: vi.fn(),
        close: vi.fn().mockResolvedValue(undefined),
      };

      mockTransport = {
        close: vi.fn().mockResolvedValue(undefined),
        onerror: null,
        onclose: null,
      };

      vi.mocked(Client).mockImplementation(() => mockClient as never);
      vi.mocked(StdioClientTransport).mockImplementation(
        () => mockTransport as never,
      );

      await mcpManager.connectServer("test-server");
    });

    it("should disconnect from MCP server successfully", async () => {
      const result = await mcpManager.disconnectServer("test-server");

      expect(result).toBe(true);
      expect(mockClient.close).toHaveBeenCalled();
      expect(mockTransport.close).toHaveBeenCalled();

      const server = mcpManager.getServer("test-server");
      expect(server?.status).toBe("disconnected");
      expect(server?.toolCount).toBe(0);
    });

    it("should return false for non-connected server", async () => {
      const result = await mcpManager.disconnectServer("non-existent");

      expect(result).toBe(false);
    });
  });

  describe("executeMcpTool", () => {
    let mockClient: MockClient;
    let mockTransport: MockTransport;

    beforeEach(async () => {
      const { promises: fs } = await import("fs");
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockConfig));
      await mcpManager.loadConfig();

      mockClient = {
        connect: vi.fn().mockResolvedValue(undefined),
        listTools: vi.fn(),
        callTool: vi.fn(),
        close: vi.fn().mockResolvedValue(undefined),
      };

      mockTransport = {
        close: vi.fn().mockResolvedValue(undefined),
        onerror: null,
        onclose: null,
      };

      vi.mocked(Client).mockImplementation(() => mockClient as never);
      vi.mocked(StdioClientTransport).mockImplementation(
        () => mockTransport as never,
      );
    });

    it("should execute MCP tool successfully", async () => {
      // Mock tools list response
      mockClient.listTools.mockResolvedValue({
        tools: [
          {
            name: "test_tool",
            description: "A test tool",
            inputSchema: { type: "object" },
          },
        ],
      });

      // Mock tool execution response
      mockClient.callTool.mockResolvedValue({
        content: [{ type: "text", text: "Tool execution result" }],
      });

      await mcpManager.connectServer("test-server");

      const result = await mcpManager.executeMcpTool(
        "mcp__test-server__test_tool",
        {
          param: "value",
        },
      );

      expect(result).toEqual({
        success: true,
        content: "Tool execution result",
        serverName: "test-server",
      });

      expect(mockClient.callTool).toHaveBeenCalledWith({
        name: "test_tool",
        arguments: { param: "value" },
      });
    });

    it("should handle tool result with images", async () => {
      // Mock tools list response
      mockClient.listTools.mockResolvedValue({
        tools: [
          {
            name: "screenshot_tool",
            description: "A screenshot tool",
            inputSchema: { type: "object" },
          },
        ],
      });

      // Mock tool execution response with image content
      mockClient.callTool.mockResolvedValue({
        content: [
          { type: "text", text: "Screenshot captured successfully" },
          {
            type: "image",
            data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChAI9jU77vwAAAABJRU5ErkJggg==",
          },
        ],
      });

      await mcpManager.connectServer("test-server");

      const result = await mcpManager.executeMcpTool(
        "mcp__test-server__screenshot_tool",
        {
          action: "capture",
        },
      );

      expect(result).toEqual({
        success: true,
        content: "Screenshot captured successfully",
        images: [
          {
            data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChAI9jU77vwAAAABJRU5ErkJggg==",
            mediaType: "image/png",
          },
        ],
        serverName: "test-server",
      });

      expect(mockClient.callTool).toHaveBeenCalledWith({
        name: "screenshot_tool",
        arguments: { action: "capture" },
      });
    });

    it("should handle tool result with multiple images", async () => {
      // Mock tools list response
      mockClient.listTools.mockResolvedValue({
        tools: [
          {
            name: "multi_screenshot_tool",
            description: "A multi-screenshot tool",
            inputSchema: { type: "object" },
          },
        ],
      });

      // Mock tool execution response with multiple images
      mockClient.callTool.mockResolvedValue({
        content: [
          { type: "text", text: "Multiple screenshots captured" },
          {
            type: "image",
            data: "image1_base64_data",
          },
          {
            type: "image",
            data: "image2_base64_data",
          },
        ],
      });

      await mcpManager.connectServer("test-server");

      const result = await mcpManager.executeMcpTool(
        "mcp__test-server__multi_screenshot_tool",
        {
          count: 2,
        },
      );

      expect(result).toEqual({
        success: true,
        content: "Multiple screenshots captured",
        images: [
          {
            data: "image1_base64_data",
            mediaType: "image/png",
          },
          {
            data: "image2_base64_data",
            mediaType: "image/png",
          },
        ],
        serverName: "test-server",
      });
    });

    it("should handle tool result with mixed content types", async () => {
      // Mock tools list response
      mockClient.listTools.mockResolvedValue({
        tools: [
          {
            name: "mixed_content_tool",
            description: "A tool with mixed content types",
            inputSchema: { type: "object" },
          },
        ],
      });

      // Mock tool execution response with mixed content
      mockClient.callTool.mockResolvedValue({
        content: [
          { type: "text", text: "First text result" },
          {
            type: "image",
            data: "screenshot_data",
          },
          { type: "text", text: "Second text result" },
          {
            type: "resource",
            resource: { uri: "file:///path/to/file.txt" },
          },
        ],
      });

      await mcpManager.connectServer("test-server");

      const result = await mcpManager.executeMcpTool(
        "mcp__test-server__mixed_content_tool",
        {},
      );

      expect(result).toEqual({
        success: true,
        content:
          "First text result\nSecond text result\n[Resource: file:///path/to/file.txt]",
        images: [
          {
            data: "screenshot_data",
            mediaType: "image/png",
          },
        ],
        serverName: "test-server",
      });
    });

    it("should handle tool result with only images (no text)", async () => {
      // Mock tools list response
      mockClient.listTools.mockResolvedValue({
        tools: [
          {
            name: "image_only_tool",
            description: "A tool that returns only images",
            inputSchema: { type: "object" },
          },
        ],
      });

      // Mock tool execution response with only images
      mockClient.callTool.mockResolvedValue({
        content: [
          {
            type: "image",
            data: "only_image_data",
          },
        ],
      });

      await mcpManager.connectServer("test-server");

      const result = await mcpManager.executeMcpTool(
        "mcp__test-server__image_only_tool",
        {},
      );

      expect(result).toEqual({
        success: true,
        content: "No content",
        images: [
          {
            data: "only_image_data",
            mediaType: "image/png",
          },
        ],
        serverName: "test-server",
      });
    });

    it("should handle tool result with unknown content types", async () => {
      // Mock tools list response
      mockClient.listTools.mockResolvedValue({
        tools: [
          {
            name: "unknown_content_tool",
            description: "A tool with unknown content types",
            inputSchema: { type: "object" },
          },
        ],
      });

      // Mock tool execution response with unknown content type
      mockClient.callTool.mockResolvedValue({
        content: [
          { type: "text", text: "Known text" },
          {
            type: "unknown_type",
            data: "some_data",
            custom_field: "custom_value",
          },
        ],
      });

      await mcpManager.connectServer("test-server");

      const result = await mcpManager.executeMcpTool(
        "mcp__test-server__unknown_content_tool",
        {},
      );

      expect(result).toEqual({
        success: true,
        content:
          'Known text\n{\n  "type": "unknown_type",\n  "data": "some_data",\n  "custom_field": "custom_value"\n}',
        serverName: "test-server",
      });
    });

    it("should throw error for non-existent tool", async () => {
      mockClient.listTools.mockResolvedValue({ tools: [] });
      await mcpManager.connectServer("test-server");

      await expect(
        mcpManager.executeMcpTool("mcp__test-server__non_existent_tool", {}),
      ).rejects.toThrow(
        "Tool mcp__test-server__non_existent_tool not found on any connected MCP server",
      );
    });

    it("should handle tool execution failure", async () => {
      mockClient.listTools.mockResolvedValue({
        tools: [
          {
            name: "test_tool",
            description: "A test tool",
            inputSchema: { type: "object" },
          },
        ],
      });

      mockClient.callTool.mockRejectedValue(new Error("Tool execution failed"));

      await mcpManager.connectServer("test-server");

      await expect(
        mcpManager.executeMcpTool("mcp__test-server__test_tool", {}),
      ).rejects.toThrow("Tool execution failed: Tool execution failed");
    });
  });

  describe("expandEnvVars in connectServer", () => {
    let mockClient: MockClient;
    let mockTransport: MockTransport;

    beforeEach(async () => {
      const { promises: fs } = await import("fs");

      const configWithEnvVars = {
        mcpServers: {
          "proxy-server": {
            command: "npx",
            args: ["--proxy=${HTTP_PROXY}", "--timeout=30"],
            env: { API_KEY: "${MY_API_KEY}", STATIC: "literal" },
          },
        },
      };
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify(configWithEnvVars),
      );
      await mcpManager.loadConfig();

      mockClient = {
        connect: vi.fn().mockResolvedValue(undefined),
        listTools: vi.fn().mockResolvedValue({ tools: [] }),
        callTool: vi.fn(),
        close: vi.fn().mockResolvedValue(undefined),
      };

      mockTransport = {
        close: vi.fn().mockResolvedValue(undefined),
        onerror: null,
        onclose: null,
      };

      vi.mocked(Client).mockImplementation(() => mockClient as never);
      vi.mocked(StdioClientTransport).mockImplementation(
        () => mockTransport as never,
      );
    });

    it("should expand ${VAR} in args using process.env", async () => {
      process.env.HTTP_PROXY = "http://proxy.example.com:8080";

      await mcpManager.connectServer("proxy-server");

      expect(StdioClientTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          args: ["--proxy=http://proxy.example.com:8080", "--timeout=30"],
        }),
      );

      delete process.env.HTTP_PROXY;
    });

    it("should expand ${VAR} in env values using process.env", async () => {
      process.env.MY_API_KEY = "secret-key-123";

      await mcpManager.connectServer("proxy-server");

      expect(StdioClientTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          env: { API_KEY: "secret-key-123", STATIC: "literal" },
        }),
      );

      delete process.env.MY_API_KEY;
    });

    it("should replace ${VAR} with empty string when env var is not set", async () => {
      delete process.env.HTTP_PROXY;
      delete process.env.MY_API_KEY;

      await mcpManager.connectServer("proxy-server");

      expect(StdioClientTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          args: ["--proxy=", "--timeout=30"],
          env: { API_KEY: "", STATIC: "literal" },
        }),
      );
    });
  });

  describe("getAllConnectedTools", () => {
    it("should return empty array when no servers connected", () => {
      const tools = mcpManager.getAllConnectedTools();
      expect(tools).toEqual([]);
    });

    it("should return tools from connected servers only", async () => {
      const { promises: fs } = await import("fs");
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({
          mcpServers: {
            server1: { command: "cmd1" },
            server2: { command: "cmd2" },
          },
        }),
      );
      await mcpManager.loadConfig();

      // Manually set server statuses for testing
      mcpManager.updateServerStatus("server1", {
        status: "connected",
        tools: [
          { name: "tool1", description: "Tool 1", inputSchema: {} },
          { name: "tool2", description: "Tool 2", inputSchema: {} },
        ],
      });

      mcpManager.updateServerStatus("server2", {
        status: "disconnected",
        tools: [{ name: "tool3", description: "Tool 3", inputSchema: {} }],
      });

      const tools = mcpManager.getAllConnectedTools();

      expect(tools).toHaveLength(2);
      expect(tools.map((t) => t.name)).toEqual(["tool1", "tool2"]);
    });
  });
});
