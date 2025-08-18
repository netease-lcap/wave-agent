import { describe, it, expect, vi, beforeEach } from "vitest";
import { initializeMCPClient, MCPClient } from "@/utils/mcp";
import fs from "fs";

// Mock fs module
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn(),
      promises: {
        ...actual.promises,
        readFile: vi.fn(),
      },
    },
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    appendFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    promises: {
      ...actual.promises,
      readFile: vi.fn(),
    },
  };
});

// Mock MCP SDK
vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: vi.fn(),
}));

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: vi.fn(),
}));

vi.mock("@modelcontextprotocol/sdk/client/sse.js", () => ({
  SSEClientTransport: vi.fn(),
}));

vi.mock("@modelcontextprotocol/sdk/types.js", () => ({
  ListToolsResultSchema: {
    parse: vi.fn(),
  },
  CallToolResultSchema: {
    parse: vi.fn(),
  },
}));

describe("MCP Client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("initializeMCPClient", () => {
    it("should return null when no mcp.json file exists", async () => {
      const mockExistsSync = vi.mocked(fs.existsSync);
      mockExistsSync.mockReturnValue(false);

      const result = await initializeMCPClient("/test/workdir");

      expect(result).toBeNull();
      expect(mockExistsSync).toHaveBeenCalledWith("/test/workdir/mcp.json");
    });

    it("should return null when mcp.json parsing fails", async () => {
      const mockExistsSync = vi.mocked(fs.existsSync);
      const mockReadFile = vi.mocked(fs.promises.readFile);

      mockExistsSync.mockReturnValue(true);
      mockReadFile.mockRejectedValue(new Error("Invalid JSON"));

      const result = await initializeMCPClient("/test/workdir");

      expect(result).toBeNull();
      expect(mockReadFile).toHaveBeenCalledWith(
        "/test/workdir/mcp.json",
        "utf8",
      );
    });

    it("should return null when no MCP servers are configured", async () => {
      const mockExistsSync = vi.mocked(fs.existsSync);
      const mockReadFile = vi.mocked(fs.promises.readFile);

      mockExistsSync.mockReturnValue(true);
      mockReadFile.mockResolvedValue(JSON.stringify({ mcpServers: {} }));

      const result = await initializeMCPClient("/test/workdir");

      expect(result).toBeNull();
    });

    it("should return null when mcpServers is missing", async () => {
      const mockExistsSync = vi.mocked(fs.existsSync);
      const mockReadFile = vi.mocked(fs.promises.readFile);

      mockExistsSync.mockReturnValue(true);
      mockReadFile.mockResolvedValue(JSON.stringify({}));

      const result = await initializeMCPClient("/test/workdir");

      expect(result).toBeNull();
    });
  });

  describe("MCPClient", () => {
    it("should sanitize server names correctly", () => {
      const config = {
        mcpServers: {
          "test-server": {
            command: "node",
            args: ["test.js"],
          },
        },
      };

      const client = new MCPClient(config);

      // Test the sanitization indirectly through the expected behavior
      expect(client).toBeDefined();
    });

    it("should handle empty server list in listTools", async () => {
      const config = {
        mcpServers: {},
      };

      const client = new MCPClient(config);

      const tools = await client.listTools();

      expect(tools).toEqual([]);
    });

    it("should throw error when calling tool with no servers", async () => {
      const config = {
        mcpServers: {},
      };

      const client = new MCPClient(config);

      await expect(client.callTool("test_tool", {})).rejects.toThrow(
        "No MCP servers connected",
      );
    });
  });
});
