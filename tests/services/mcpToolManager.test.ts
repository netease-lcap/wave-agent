import { describe, it, expect, vi, beforeEach } from "vitest";
import { MCPToolManager } from "@/services/mcpToolManager";
import { initializeMCPClient, type MCPClient } from "@/utils/mcp";

// Mock the mcp module
vi.mock("@/utils/mcp", () => ({
  initializeMCPClient: vi.fn(),
}));

// Define mock MCP client type for testing
interface MockMCPClient {
  listTools: ReturnType<typeof vi.fn>;
  callTool: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
}

describe("MCPToolManager", () => {
  let mcpToolManager: MCPToolManager;

  beforeEach(() => {
    mcpToolManager = new MCPToolManager();
    vi.clearAllMocks();
  });

  it("should initialize without MCP client when no config is available", async () => {
    const mockInitializeMCPClient = vi.mocked(initializeMCPClient);
    mockInitializeMCPClient.mockResolvedValue(null);

    await mcpToolManager.initialize("/test/workdir");

    expect(mockInitializeMCPClient).toHaveBeenCalledWith("/test/workdir");
    expect(mcpToolManager.getTools()).toHaveLength(0);
  });

  it("should initialize with MCP client when config is available", async () => {
    const mockMCPClient: MockMCPClient = {
      listTools: vi.fn().mockResolvedValue([
        {
          name: "test_tool",
          description: "Test tool",
          inputSchema: { type: "object", properties: {} },
        },
      ]),
      callTool: vi.fn(),
      disconnect: vi.fn(),
    };

    const mockInitializeMCPClient = vi.mocked(initializeMCPClient);
    mockInitializeMCPClient.mockResolvedValue(
      mockMCPClient as unknown as MCPClient,
    );

    await mcpToolManager.initialize("/test/workdir");

    expect(mockInitializeMCPClient).toHaveBeenCalledWith("/test/workdir");
    expect(mockMCPClient.listTools).toHaveBeenCalled();

    const tools = mcpToolManager.getTools();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("test_tool");
    expect(tools[0].description).toBe("Test tool");
  });

  it("should handle initialization errors gracefully", async () => {
    const mockInitializeMCPClient = vi.mocked(initializeMCPClient);
    mockInitializeMCPClient.mockRejectedValue(
      new Error("Initialization failed"),
    );

    // Should not throw
    await mcpToolManager.initialize("/test/workdir");

    expect(mcpToolManager.getTools()).toHaveLength(0);
  });

  it("should check if tool is from MCP", async () => {
    const mockMCPClient: MockMCPClient = {
      listTools: vi.fn().mockResolvedValue([
        {
          name: "mcp_tool",
          description: "MCP tool",
          inputSchema: { type: "object", properties: {} },
        },
      ]),
      callTool: vi.fn(),
      disconnect: vi.fn(),
    };

    const mockInitializeMCPClient = vi.mocked(initializeMCPClient);
    mockInitializeMCPClient.mockResolvedValue(
      mockMCPClient as unknown as MCPClient,
    );

    await mcpToolManager.initialize("/test/workdir");

    expect(mcpToolManager.isToolFromMCP("mcp_tool")).toBe(true);
    expect(mcpToolManager.isToolFromMCP("non_mcp_tool")).toBe(false);
  });

  it("should call MCP tool correctly", async () => {
    const mockResult = {
      content: [{ type: "text", text: "Tool result" }],
      isError: false,
    };

    const mockMCPClient: MockMCPClient = {
      listTools: vi.fn().mockResolvedValue([
        {
          name: "test_tool",
          description: "Test tool",
          inputSchema: { type: "object", properties: {} },
        },
      ]),
      callTool: vi.fn().mockResolvedValue(mockResult),
      disconnect: vi.fn(),
    };

    const mockInitializeMCPClient = vi.mocked(initializeMCPClient);
    mockInitializeMCPClient.mockResolvedValue(
      mockMCPClient as unknown as MCPClient,
    );

    await mcpToolManager.initialize("/test/workdir");

    const result = await mcpToolManager.callMCPTool("test_tool", {
      arg: "value",
    });

    expect(mockMCPClient.callTool).toHaveBeenCalledWith("test_tool", {
      arg: "value",
    });
    expect(result.success).toBe(true);
    expect(result.content).toBe("Tool result");
  });

  it("should handle MCP tool execution errors", async () => {
    const mockMCPClient: MockMCPClient = {
      listTools: vi.fn().mockResolvedValue([
        {
          name: "test_tool",
          description: "Test tool",
          inputSchema: { type: "object", properties: {} },
        },
      ]),
      callTool: vi.fn().mockRejectedValue(new Error("Tool execution failed")),
      disconnect: vi.fn(),
    };

    const mockInitializeMCPClient = vi.mocked(initializeMCPClient);
    mockInitializeMCPClient.mockResolvedValue(
      mockMCPClient as unknown as MCPClient,
    );

    await mcpToolManager.initialize("/test/workdir");

    const result = await mcpToolManager.callMCPTool("test_tool", {
      arg: "value",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Tool execution failed");
  });

  it("should disconnect properly", async () => {
    const mockMCPClient: MockMCPClient = {
      listTools: vi.fn().mockResolvedValue([]),
      callTool: vi.fn(),
      disconnect: vi.fn(),
    };

    const mockInitializeMCPClient = vi.mocked(initializeMCPClient);
    mockInitializeMCPClient.mockResolvedValue(
      mockMCPClient as unknown as MCPClient,
    );

    await mcpToolManager.initialize("/test/workdir");
    await mcpToolManager.disconnect();

    expect(mockMCPClient.disconnect).toHaveBeenCalled();
    expect(mcpToolManager.getTools()).toHaveLength(0);
  });
});
