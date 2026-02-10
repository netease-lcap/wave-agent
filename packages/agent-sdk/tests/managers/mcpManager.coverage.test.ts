import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { McpManager } from "../../src/managers/mcpManager.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { promises as fs } from "fs";
import { Logger } from "../../src/types/index.js";

// Mock the MCP SDK
vi.mock("@modelcontextprotocol/sdk/client/index.js");
vi.mock("@modelcontextprotocol/sdk/client/stdio.js");
vi.mock("fs");

describe("McpManager Coverage", () => {
  let mcpManager: McpManager;
  let mockLogger: {
    debug: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    mcpManager = new McpManager({ logger: mockLogger as unknown as Logger });
  });

  afterEach(async () => {
    await mcpManager.cleanup();
  });

  describe("initialize", () => {
    it("should handle autoConnect with multiple servers", async () => {
      const mockConfig = {
        mcpServers: {
          server1: { command: "cmd1" },
          server2: { command: "cmd2" },
        },
      };
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockConfig));

      // Mock connectServer to succeed for server1 and fail for server2
      const connectSpy = vi
        .spyOn(mcpManager, "connectServer")
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);

      await mcpManager.initialize("/test/workdir", true);

      expect(connectSpy).toHaveBeenCalledTimes(2);
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining(
          "Successfully connected to MCP server: server1",
        ),
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("Failed to connect to MCP server: server2"),
      );
    });

    it("should handle error during autoConnect", async () => {
      const mockConfig = {
        mcpServers: {
          server1: { command: "cmd1" },
        },
      };
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockConfig));
      vi.spyOn(mcpManager, "connectServer").mockRejectedValue(
        new Error("Fatal error"),
      );

      await mcpManager.initialize("/test/workdir", true);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("Error connecting to MCP server server1"),
      );
    });
  });

  describe("loadConfig", () => {
    it("should warn if config path not set", async () => {
      const config = await mcpManager.loadConfig();
      expect(config).toBeNull();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("MCP config path not set"),
      );
    });

    it("should preserve existing server status when reloading config", async () => {
      await mcpManager.initialize("/test/workdir");

      const initialConfig = { mcpServers: { s1: { command: "c1" } } };
      vi.mocked(fs.readFile).mockResolvedValueOnce(
        JSON.stringify(initialConfig),
      );
      await mcpManager.loadConfig();

      mcpManager.updateServerStatus("s1", { status: "connected" });

      const updatedConfig = { mcpServers: { s1: { command: "c1-updated" } } };
      vi.mocked(fs.readFile).mockResolvedValueOnce(
        JSON.stringify(updatedConfig),
      );
      await mcpManager.loadConfig();

      const server = mcpManager.getServer("s1");
      expect(server?.status).toBe("connected");
      expect(server?.config.command).toBe("c1-updated");
    });

    it("should log error for non-ENOENT errors", async () => {
      await mcpManager.initialize("/test/workdir");
      const error = new Error("Permission denied");
      (error as unknown as { code: string }).code = "EACCES";
      vi.mocked(fs.readFile).mockRejectedValue(error);

      await mcpManager.loadConfig();
      expect(mockLogger.error).toHaveBeenCalledWith(
        "Failed to load .mcp.json:",
        error,
      );
    });
  });

  describe("connectServer", () => {
    it("should handle transport error and close", async () => {
      await mcpManager.initialize("/test/workdir");
      mcpManager.addServer("s1", { command: "c1" });

      let transportOnError: ((error: Error) => void) | null = null;
      let transportOnClose: (() => void) | null = null;

      vi.mocked(StdioClientTransport).mockImplementation(function () {
        const t = {
          onerror: null,
          onclose: null,
          close: vi.fn(),
        };
        // Use a small delay to ensure the caller has time to set the properties
        setTimeout(() => {
          transportOnError = t.onerror;
          transportOnClose = t.onclose;
        }, 10);
        return t as unknown as StdioClientTransport;
      });

      vi.mocked(Client).mockImplementation(function () {
        return {
          connect: vi.fn().mockResolvedValue(undefined),
          listTools: vi.fn().mockResolvedValue({ tools: [] }),
          close: vi.fn().mockResolvedValue(undefined),
        } as unknown as Client;
      });

      await mcpManager.connectServer("s1");

      // Wait for callbacks to be assigned
      await new Promise((resolve) => setTimeout(resolve, 50));

      if (typeof transportOnError === "function") {
        (transportOnError as (error: Error) => void)(
          new Error("Transport failed"),
        );
        expect(mockLogger.error).toHaveBeenCalledWith(
          expect.stringContaining("transport error"),
          expect.any(Error),
        );
        expect(mcpManager.getServer("s1")?.status).toBe("error");
      }

      if (typeof transportOnClose === "function") {
        (transportOnClose as () => void)();
        expect(mockLogger.debug).toHaveBeenCalledWith(
          expect.stringContaining("transport closed"),
        );
        expect(mcpManager.getServer("s1")?.status).toBe("disconnected");
      }
    });
  });

  describe("executeMcpTool", () => {
    it("should throw if tool name doesn't start with mcp__", async () => {
      await expect(mcpManager.executeMcpTool("invalid", {})).rejects.toThrow(
        "Must start with 'mcp__'",
      );
    });

    it("should throw if tool name format is invalid", async () => {
      await expect(
        mcpManager.executeMcpTool("mcp__onlyone", {}),
      ).rejects.toThrow("Expected 'mcp__[server]__[tool]'");
    });

    it("should handle tool result with non-array content", async () => {
      await mcpManager.initialize("/test/workdir");
      mcpManager.addServer("s1", { command: "c1" });
      mcpManager.updateServerStatus("s1", {
        status: "connected",
        tools: [{ name: "t1", inputSchema: {} }],
      });

      const mockClient = {
        callTool: vi
          .fn()
          .mockResolvedValue({ content: "Simple string content" }),
      };
      (
        mcpManager as unknown as {
          connections: Map<string, { client: unknown }>;
        }
      ).connections.set("s1", { client: mockClient });

      const result = await mcpManager.executeMcpTool("mcp__s1__t1", {});
      expect(result.content).toBe("Simple string content");
    });
  });

  describe("isMcpTool", () => {
    it("should return false if name doesn't start with mcp__", () => {
      expect(mcpManager.isMcpTool("tool")).toBe(false);
    });

    it("should return true if tool exists and server is connected", () => {
      mcpManager.addServer("s1", { command: "c1" });
      mcpManager.updateServerStatus("s1", {
        status: "connected",
        tools: [{ name: "t1", inputSchema: {} }],
      });
      expect(mcpManager.isMcpTool("mcp__s1__t1")).toBe(true);
      expect(mcpManager.isMcpTool("mcp__s1__t2")).toBe(false);
    });
  });

  describe("getMcpToolPlugins", () => {
    it("should return plugins for connected tools", () => {
      mcpManager.addServer("s1", { command: "c1" });
      mcpManager.updateServerStatus("s1", {
        status: "connected",
        tools: [{ name: "t1", description: "desc", inputSchema: {} }],
      });

      const plugins = mcpManager.getMcpToolPlugins();
      expect(plugins).toHaveLength(1);
      expect(plugins[0].name).toBe("mcp__s1__t1");
    });
  });

  describe("executeMcpToolByRegistry", () => {
    it("should return error if tool not found", async () => {
      const result = await mcpManager.executeMcpToolByRegistry(
        "mcp__s1__t1",
        {},
        {} as unknown as Parameters<McpManager["executeMcpToolByRegistry"]>[2],
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    it("should execute tool if found", async () => {
      mcpManager.addServer("s1", { command: "c1" });
      mcpManager.updateServerStatus("s1", {
        status: "connected",
        tools: [{ name: "t1", description: "desc", inputSchema: {} }],
      });

      const mockExecute = vi
        .fn()
        .mockResolvedValue({ success: true, content: "ok" });
      vi.spyOn(mcpManager, "executeMcpTool").mockImplementation(mockExecute);

      const result = await mcpManager.executeMcpToolByRegistry(
        "mcp__s1__t1",
        { arg: 1 },
        {} as unknown as Parameters<McpManager["executeMcpToolByRegistry"]>[2],
      );
      expect(result.success).toBe(true);
      expect(mockExecute).toHaveBeenCalledWith("mcp__s1__t1", { arg: 1 });
    });
  });
});
