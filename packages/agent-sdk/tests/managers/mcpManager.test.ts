import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  McpManager,
  expandEnvVars,
  resolveMcpConfig,
} from "../../src/managers/mcpManager.js";
import { Container } from "../../src/utils/container.js";
import type { McpServerConfig } from "../../src/types/index.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

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
  stderr: import("node:stream").Stream | null;
}

// Mock the MCP SDK
vi.mock("@modelcontextprotocol/sdk/client/index.js");
vi.mock("@modelcontextprotocol/sdk/client/stdio.js");
vi.mock("@modelcontextprotocol/sdk/client/sse.js");
vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js");
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
    const container = new Container();
    mcpManager = new McpManager(container);
    mcpManager.initialize("/test/workdir");
  });

  afterEach(async () => {
    await mcpManager.cleanup();
    vi.restoreAllMocks();
  });

  describe("constructor", () => {
    it("should accept logger parameter", () => {
      const container = new Container();
      const manager = new McpManager(container);
      expect(manager).toBeInstanceOf(McpManager);
    });

    it("should work without logger parameter", () => {
      const container = new Container();
      const manager = new McpManager(container);
      expect(manager).toBeInstanceOf(McpManager);
    });

    it("should accept callbacks parameter", () => {
      const mockCallback = vi.fn();
      const container = new Container();
      const manager = new McpManager(container, {
        callbacks: { onServersChange: mockCallback },
      });
      expect(manager).toBeInstanceOf(McpManager);
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

    it("should merge workspace config with existing plugin config", async () => {
      const { promises: fs } = await import("fs");

      // Simulate plugin server added before loadConfig
      const pluginServerConfig: McpServerConfig = {
        command: "plugin-mcp",
        pluginRoot: "/path/to/plugin",
      };
      mcpManager.addServer("plugin-server", pluginServerConfig);

      // Workspace config has a different server
      const workspaceConfig = {
        mcpServers: {
          "workspace-server": {
            command: "workspace-mcp",
          },
        },
      };
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(workspaceConfig));

      await mcpManager.loadConfig();
      const config = mcpManager.getConfig();

      expect(config).not.toBeNull();
      expect(config?.mcpServers).toHaveProperty("plugin-server");
      expect(config?.mcpServers).toHaveProperty("workspace-server");
      expect(Object.keys(config!.mcpServers)).toHaveLength(2);
    });

    it("should preserve plugin server status when merging", async () => {
      const { promises: fs } = await import("fs");

      // Add plugin server and set it to connected
      const pluginServerConfig: McpServerConfig = {
        command: "plugin-mcp",
        pluginRoot: "/path/to/plugin",
      };
      mcpManager.addServer("plugin-server", pluginServerConfig);
      mcpManager.updateServerStatus("plugin-server", {
        status: "connected",
        toolCount: 3,
      });

      const workspaceConfig = {
        mcpServers: {
          "workspace-server": { command: "workspace-mcp" },
        },
      };
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(workspaceConfig));

      await mcpManager.loadConfig();

      const pluginServer = mcpManager.getServer("plugin-server");
      expect(pluginServer?.status).toBe("connected");
      expect(pluginServer?.toolCount).toBe(3);
    });

    it("should let workspace server override plugin server with same name", async () => {
      const { promises: fs } = await import("fs");

      // Add a plugin server named "shared-server"
      const pluginServerConfig: McpServerConfig = {
        command: "plugin-mcp",
        pluginRoot: "/path/to/plugin",
      };
      mcpManager.addServer("shared-server", pluginServerConfig);

      // Workspace config has a server with the same name but different config
      const workspaceConfig = {
        mcpServers: {
          "shared-server": {
            command: "workspace-mcp",
            args: ["--verbose"],
          },
        },
      };
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(workspaceConfig));

      await mcpManager.loadConfig();
      const config = mcpManager.getConfig();

      // Workspace config should override
      expect(config?.mcpServers["shared-server"]).toEqual({
        command: "workspace-mcp",
        args: ["--verbose"],
      });
    });

    it("should append new workspace servers to existing config", async () => {
      const { promises: fs } = await import("fs");

      // Start with existing config
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({
          mcpServers: {
            "server-a": { command: "cmd-a" },
          },
        }),
      );
      await mcpManager.loadConfig();

      // Second loadConfig with additional server
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({
          mcpServers: {
            "server-b": { command: "cmd-b" },
          },
        }),
      );
      await mcpManager.loadConfig();

      const config = mcpManager.getConfig();
      expect(config?.mcpServers).toHaveProperty("server-a");
      expect(config?.mcpServers).toHaveProperty("server-b");
      expect(Object.keys(config!.mcpServers)).toHaveLength(2);
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

  describe("initialize with autoConnect", () => {
    let mockClient: MockClient;
    let mockTransport: MockTransport;

    beforeEach(() => {
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
        stderr: null,
      };

      vi.mocked(Client).mockImplementation(function () {
        return mockClient as never;
      });
      vi.mocked(StdioClientTransport).mockImplementation(function () {
        return mockTransport as never;
      });
    });

    it("should load config and start background connections when autoConnect is true", async () => {
      const { promises: fs } = await import("fs");
      const configWithServers = {
        mcpServers: {
          "auto-server": { command: "auto-mcp" },
        },
      };
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify(configWithServers),
      );

      const container = new Container();
      const manager = new McpManager(container);
      await manager.initialize("/test/workdir", true);

      await vi.waitFor(() => {
        expect(StdioClientTransport).toHaveBeenCalled();
      });

      const config = manager.getConfig();
      expect(config?.mcpServers).toHaveProperty("auto-server");

      await manager.cleanup();
    });

    it("should merge plugin servers with workspace config during autoConnect init", async () => {
      const { promises: fs } = await import("fs");
      const container = new Container();
      const manager = new McpManager(container);

      // Simulate plugin server added before initialize
      manager.initialize("/test/workdir");
      const pluginServerConfig: McpServerConfig = {
        command: "plugin-mcp",
        pluginRoot: "/path/to/plugin",
      };
      manager.addServer("plugin-server", pluginServerConfig);

      // Workspace config
      const workspaceConfig = {
        mcpServers: {
          "workspace-server": { command: "workspace-mcp" },
        },
      };
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(workspaceConfig));

      await manager.initialize("/test/workdir", true);

      await vi.waitFor(() => {
        expect(StdioClientTransport).toHaveBeenCalled();
      });

      const config = manager.getConfig();
      expect(config?.mcpServers).toHaveProperty("plugin-server");
      expect(config?.mcpServers).toHaveProperty("workspace-server");

      await manager.cleanup();
    });
  });

  describe("constructor mcpServers option", () => {
    it("should register constructor-provided servers before file load", async () => {
      const container = new Container();
      const manager = new McpManager(container, {
        mcpServers: {
          "constructor-server": { command: "constructor-mcp" },
        },
      });
      await manager.initialize("/test/workdir", false);

      // Server should be registered even without loading .mcp.json
      const servers = manager.getAllServers();
      expect(servers).toHaveLength(1);
      expect(servers[0].name).toBe("constructor-server");
      expect(servers[0].config.command).toBe("constructor-mcp");

      await manager.cleanup();
    });

    it("should have constructor servers available before loadConfig runs", async () => {
      const { promises: fs } = await import("fs");
      const container = new Container();
      const manager = new McpManager(container, {
        mcpServers: {
          "ctor-server": { command: "ctor-mcp" },
        },
      });
      await manager.initialize("/test/workdir", false);

      // Verify constructor server is registered
      expect(manager.getServer("ctor-server")).toBeDefined();

      // Now load .mcp.json
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({
          mcpServers: {
            "file-server": { command: "file-mcp" },
          },
        }),
      );
      await manager.loadConfig();

      // Both servers should be present
      expect(manager.getServer("ctor-server")).toBeDefined();
      expect(manager.getServer("file-server")).toBeDefined();

      const config = manager.getConfig();
      expect(config?.mcpServers).toHaveProperty("ctor-server");
      expect(config?.mcpServers).toHaveProperty("file-server");

      await manager.cleanup();
    });

    it("should let constructor-provided servers override .mcp.json for same-named servers", async () => {
      const { promises: fs } = await import("fs");
      const container = new Container();
      const manager = new McpManager(container, {
        mcpServers: {
          "shared-server": { command: "ctor-command", args: ["--ctor"] },
        },
      });
      await manager.initialize("/test/workdir", false);

      // .mcp.json has a server with the same name but different config
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify({
          mcpServers: {
            "shared-server": { command: "file-command", args: ["--file"] },
          },
        }),
      );
      await manager.loadConfig();

      // Constructor config should win for same-named server
      const config = manager.getConfig();
      expect(config?.mcpServers["shared-server"]).toEqual({
        command: "ctor-command",
        args: ["--ctor"],
      });

      await manager.cleanup();
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
        stderr: null,
      };

      vi.mocked(Client).mockImplementation(function () {
        return mockClient as never;
      });
      vi.mocked(StdioClientTransport).mockImplementation(function () {
        return mockTransport as never;
      });
      vi.mocked(SSEClientTransport).mockImplementation(function () {
        return mockTransport as never;
      });
      vi.mocked(StreamableHTTPClientTransport).mockImplementation(function () {
        return mockTransport as never;
      });
    });

    it("should connect to MCP server successfully via stdio", async () => {
      const result = await mcpManager.connectServer("test-server");

      expect(result).toBe(true);
      expect(Client).toHaveBeenCalledWith(
        { name: "wave-code", version: "1.0.0" },
        { capabilities: { tools: {} } },
      );
      expect(StdioClientTransport).toHaveBeenCalledWith({
        command: "npx",
        args: ["test-mcp-server"],
        env: {
          ...process.env,
          TEST_VAR: "value",
        },
        cwd: "/test/workdir",
        stderr: "pipe",
      });
      expect(mockClient.connect).toHaveBeenCalledWith(mockTransport);

      const server = mcpManager.getServer("test-server");
      expect(server?.status).toBe("connected");
      expect(server?.toolCount).toBe(1);
    });

    it("should connect to MCP server successfully via SSE", async () => {
      const sseConfig = {
        mcpServers: {
          "sse-server": {
            url: "https://example.com/sse",
          },
        },
      };
      const { promises: fs } = await import("fs");
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(sseConfig));
      await mcpManager.loadConfig();

      // Mock Streamable HTTP to fail to trigger fallback
      vi.mocked(StreamableHTTPClientTransport).mockImplementation(function () {
        throw new Error("Streamable HTTP not supported");
      });

      const result = await mcpManager.connectServer("sse-server");

      expect(result).toBe(true);
      expect(SSEClientTransport).toHaveBeenCalledWith(
        new URL("https://example.com/sse"),
        expect.objectContaining({
          requestInit: { headers: undefined },
        }),
      );
      expect(mockClient.connect).toHaveBeenCalledWith(mockTransport);

      const server = mcpManager.getServer("sse-server");
      expect(server?.status).toBe("connected");
    });

    it("should connect to MCP server successfully via Streamable HTTP", async () => {
      const streamableConfig = {
        mcpServers: {
          "streamable-server": {
            url: "https://example.com/streamable",
            headers: { Authorization: "Bearer test-token" },
          },
        },
      };
      const { promises: fs } = await import("fs");
      vi.mocked(fs.readFile).mockResolvedValue(
        JSON.stringify(streamableConfig),
      );
      await mcpManager.loadConfig();

      vi.mocked(StreamableHTTPClientTransport).mockImplementation(function () {
        return mockTransport as never;
      });

      const result = await mcpManager.connectServer("streamable-server");

      expect(result).toBe(true);
      expect(StreamableHTTPClientTransport).toHaveBeenCalledWith(
        new URL("https://example.com/streamable"),
        {
          requestInit: {
            headers: { Authorization: "Bearer test-token" },
          },
        },
      );
      expect(mockClient.connect).toHaveBeenCalledWith(mockTransport);

      const server = mcpManager.getServer("streamable-server");
      expect(server?.status).toBe("connected");
    });

    it("should fallback to SSE if Streamable HTTP fails", async () => {
      const config = {
        mcpServers: {
          "fallback-server": {
            url: "https://example.com/fallback",
            headers: { "X-Custom": "value" },
          },
        },
      };
      const { promises: fs } = await import("fs");
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(config));
      await mcpManager.loadConfig();

      // First call to connect (Streamable HTTP) fails
      mockClient.connect.mockRejectedValueOnce(
        new Error("Streamable HTTP failed"),
      );

      const result = await mcpManager.connectServer("fallback-server");

      expect(result).toBe(true);
      expect(StreamableHTTPClientTransport).toHaveBeenCalled();
      expect(SSEClientTransport).toHaveBeenCalledWith(
        new URL("https://example.com/fallback"),
        {
          requestInit: { headers: { "X-Custom": "value" } },
        },
      );

      const server = mcpManager.getServer("fallback-server");
      expect(server?.status).toBe("connected");
    });

    it("should throw error if neither command nor url is provided", async () => {
      const invalidConfig = {
        mcpServers: {
          "invalid-server": {},
        },
      };
      const { promises: fs } = await import("fs");
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(invalidConfig));
      await mcpManager.loadConfig();

      const result = await mcpManager.connectServer("invalid-server");

      expect(result).toBe(false);
      const server = mcpManager.getServer("invalid-server");
      expect(server?.status).toBe("error");
      expect(server?.error).toContain("must include either 'command' or 'url'");
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

    it("should inject WAVE_PLUGIN_ROOT into env for plugin-owned stdio servers", async () => {
      const pluginConfig = {
        mcpServers: {
          "plugin-server": {
            command: "npx",
            args: ["plugin-mcp"],
            pluginRoot: "/path/to/plugin",
          },
        },
      };
      const { promises: fs } = await import("fs");
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(pluginConfig));
      await mcpManager.loadConfig();

      await mcpManager.connectServer("plugin-server");

      expect(StdioClientTransport).toHaveBeenCalledWith({
        command: "npx",
        args: ["plugin-mcp"],
        env: {
          ...process.env,
          WAVE_PLUGIN_ROOT: "/path/to/plugin",
        },
        cwd: "/test/workdir",
        stderr: "pipe",
      });
    });

    it("should substitute ${WAVE_PLUGIN_ROOT} in command for plugin-owned stdio servers", async () => {
      const pluginConfig: McpServerConfig = {
        command: "${WAVE_PLUGIN_ROOT}/bin/mcp-server",
        args: ["--config", "${WAVE_PLUGIN_ROOT}/config.json"],
        pluginRoot: "/path/to/plugin",
      };
      mcpManager.addServer("plugin-server", pluginConfig);

      await mcpManager.connectServer("plugin-server");

      expect(StdioClientTransport).toHaveBeenCalledWith({
        command: "/path/to/plugin/bin/mcp-server",
        args: ["--config", "/path/to/plugin/config.json"],
        env: {
          ...process.env,
          WAVE_PLUGIN_ROOT: "/path/to/plugin",
        },
        cwd: "/test/workdir",
        stderr: "pipe",
      });
    });

    it("should substitute ${WAVE_PLUGIN_ROOT} in env values for plugin-owned stdio servers", async () => {
      const pluginConfig: McpServerConfig = {
        command: "npx",
        args: ["plugin-mcp"],
        env: {
          CONFIG_PATH: "${WAVE_PLUGIN_ROOT}/config/server.json",
          OTHER_VAR: "static-value",
        },
        pluginRoot: "/path/to/plugin",
      };
      mcpManager.addServer("plugin-server", pluginConfig);

      await mcpManager.connectServer("plugin-server");

      expect(StdioClientTransport).toHaveBeenCalledWith({
        command: "npx",
        args: ["plugin-mcp"],
        env: {
          ...process.env,
          WAVE_PLUGIN_ROOT: "/path/to/plugin",
          CONFIG_PATH: "/path/to/plugin/config/server.json",
          OTHER_VAR: "static-value",
        },
        cwd: "/test/workdir",
        stderr: "pipe",
      });
    });

    it("should not substitute ${WAVE_PLUGIN_ROOT} for non-plugin stdio servers", async () => {
      const nonPluginConfig: McpServerConfig = {
        command: "${WAVE_PLUGIN_ROOT}/bin/mcp-server",
        args: ["${WAVE_PLUGIN_ROOT}/arg"],
      };
      mcpManager.addServer("non-plugin-server", nonPluginConfig);

      await mcpManager.connectServer("non-plugin-server");

      expect(StdioClientTransport).toHaveBeenCalledWith({
        command: "${WAVE_PLUGIN_ROOT}/bin/mcp-server",
        args: ["${WAVE_PLUGIN_ROOT}/arg"],
        env: {
          ...process.env,
        },
        cwd: "/test/workdir",
        stderr: "pipe",
      });
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
        stderr: null,
      };

      vi.mocked(Client).mockImplementation(function () {
        return mockClient as never;
      });
      vi.mocked(StdioClientTransport).mockImplementation(function () {
        return mockTransport as never;
      });

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
        stderr: null,
      };

      vi.mocked(Client).mockImplementation(function () {
        return mockClient as never;
      });
      vi.mocked(StdioClientTransport).mockImplementation(function () {
        return mockTransport as never;
      });
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
          'Known text\n{"type":"unknown_type","data":"some_data","custom_field":"custom_value"}',
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

describe("expandEnvVars", () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should replace ${VAR} with env value", () => {
    process.env.TEST_KEY = "secret-value";
    expect(expandEnvVars("prefix-${TEST_KEY}-suffix")).toBe(
      "prefix-secret-value-suffix",
    );
  });

  it("should replace ${VAR:-default} with env value when set", () => {
    process.env.FOO = "bar";
    expect(expandEnvVars("${FOO:-fallback}")).toBe("bar");
  });

  it("should use default when env is not set", () => {
    delete process.env.MISSING_VAR;
    expect(expandEnvVars("${MISSING_VAR:-my-default}")).toBe("my-default");
  });

  it("should replace with empty string when env is not set and no default", () => {
    delete process.env.NO_DEFAULT;
    expect(expandEnvVars("${NO_DEFAULT}")).toBe("");
  });

  it("should handle multiple vars in one string", () => {
    process.env.A = "hello";
    process.env.B = "world";
    expect(expandEnvVars("${A} ${B}")).toBe("hello world");
  });

  it("should leave non-matching text unchanged", () => {
    expect(expandEnvVars("no vars here")).toBe("no vars here");
  });
});

describe("resolveMcpConfig", () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should expand env vars in command and args", () => {
    process.env.MCP_CMD = "npx";
    process.env.MCP_ARG = "--verbose";
    const config = {
      mcpServers: {
        s: { command: "${MCP_CMD}", args: ["${MCP_ARG}"] },
      },
    };
    const resolved = resolveMcpConfig(config);
    expect(resolved.mcpServers.s.command).toBe("npx");
    expect(resolved.mcpServers.s.args).toEqual(["--verbose"]);
  });

  it("should expand env vars in env values", () => {
    process.env.SECRET = "my-secret";
    const config = {
      mcpServers: {
        s: { command: "cmd", env: { API_KEY: "${SECRET}" } },
      },
    };
    const resolved = resolveMcpConfig(config);
    expect(resolved.mcpServers.s.env).toEqual({ API_KEY: "my-secret" });
  });

  it("should expand env vars in url", () => {
    process.env.MCP_HOST = "example.com";
    const config = {
      mcpServers: {
        s: { url: "https://${MCP_HOST}/sse" },
      },
    };
    const resolved = resolveMcpConfig(config);
    expect(resolved.mcpServers.s.url).toBe("https://example.com/sse");
  });

  it("should expand env vars in headers values", () => {
    process.env.AUTH_TOKEN = "tok123";
    const config = {
      mcpServers: {
        s: {
          url: "https://example.com",
          headers: { Authorization: "Bearer ${AUTH_TOKEN}" },
        },
      },
    };
    const resolved = resolveMcpConfig(config);
    expect(resolved.mcpServers.s.headers).toEqual({
      Authorization: "Bearer tok123",
    });
  });

  it("should handle defaults in url expansion", () => {
    delete process.env.PORT;
    const config = {
      mcpServers: {
        s: { url: "http://localhost:${PORT:-3000}/sse" },
      },
    };
    const resolved = resolveMcpConfig(config);
    expect(resolved.mcpServers.s.url).toBe("http://localhost:3000/sse");
  });

  it("should not mutate the original config", () => {
    process.env.URL = "https://real.com";
    const config = {
      mcpServers: {
        s: { url: "${URL}" },
      },
    };
    resolveMcpConfig(config);
    expect(config.mcpServers.s.url).toBe("${URL}");
  });
});
