import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { McpManager } from "../../src/managers/mcpManager.js";
import { Container } from "../../src/utils/container.js";
import {} from "../../src/types/index.js";

vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock the MCP SDK
vi.mock("@modelcontextprotocol/sdk/client/index.js");
vi.mock("@modelcontextprotocol/sdk/client/stdio.js");
vi.mock("fs");

describe("McpManager tool registry and routing", () => {
  let mcpManager: McpManager;

  beforeEach(() => {
    vi.clearAllMocks();
    const container = new Container();
    mcpManager = new McpManager(container);
  });

  afterEach(async () => {
    await mcpManager.cleanup();
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

    it("should retain tools while a server is reconnecting", () => {
      mcpManager.addServer("s1", { command: "c1" });
      mcpManager.updateServerStatus("s1", {
        status: "connected",
        tools: [{ name: "t1", description: "desc", inputSchema: {} }],
      });

      // Transient SSE disconnect: status flips to "reconnecting" but the
      // tool snapshot is preserved (updateServerStatus merges).
      mcpManager.updateServerStatus("s1", {
        status: "reconnecting",
        error: "SSE stream disconnected",
      });

      const plugins = mcpManager.getMcpToolPlugins();
      expect(plugins).toHaveLength(1);
      expect(plugins[0].name).toBe("mcp__s1__t1");
    });

    it("should drop tools once a server errors out", () => {
      mcpManager.addServer("s1", { command: "c1" });
      mcpManager.updateServerStatus("s1", {
        status: "connected",
        tools: [{ name: "t1", description: "desc", inputSchema: {} }],
      });
      mcpManager.updateServerStatus("s1", {
        status: "error",
        error: "boom",
      });

      expect(mcpManager.getMcpToolPlugins()).toHaveLength(0);
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
      expect(mockExecute).toHaveBeenCalledWith(
        "mcp__s1__t1",
        { arg: 1 },
        expect.anything(),
      );
    });
  });
});
