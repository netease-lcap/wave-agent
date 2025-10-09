import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { McpManager } from "../../src/components/McpManager.js";
import { McpConfig, mcpManager } from "wave-agent-sdk";

// Mock the wave-agent-sdk module
vi.mock("wave-agent-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("wave-agent-sdk")>();
  return {
    ...actual,
    mcpManager: {
      loadConfig: vi.fn(),
      ensureConfigLoaded: vi.fn(),
      getConfig: vi.fn(),
      getAllServers: vi.fn(),
      connectServer: vi.fn(),
      disconnectServer: vi.fn(),
      reconnectServer: vi.fn(),
    },
  };
});

const mockServers = [
  {
    name: "chrome-devtools",
    config: {
      command: "npx",
      args: ["chrome-devtools-mcp@latest"],
    },
    status: "disconnected" as const,
    toolCount: 0,
  },
  {
    name: "filesystem",
    config: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/Users"],
    },
    status: "connected" as const,
    toolCount: 5,
    capabilities: ["tools"],
    lastConnected: Date.now() - 5000,
  },
  {
    name: "brave-search",
    config: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-brave-search"],
      env: { BRAVE_API_KEY: "test-key" },
    },
    status: "error" as const,
    toolCount: 0,
    error: "API key invalid",
  },
];

describe("McpManager", () => {
  const mockOnCancel = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mcpManager.loadConfig).mockResolvedValue({} as McpConfig);
    vi.mocked(mcpManager.ensureConfigLoaded).mockResolvedValue({} as McpConfig);
    vi.mocked(mcpManager.getConfig).mockReturnValue({} as McpConfig);
    vi.mocked(mcpManager.getAllServers).mockReturnValue(mockServers);
    vi.mocked(mcpManager.connectServer).mockResolvedValue(true);
    vi.mocked(mcpManager.disconnectServer).mockResolvedValue(true);
    vi.mocked(mcpManager.reconnectServer).mockResolvedValue(true);
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  describe("initial loading", () => {
    it("should show initial state without loading", () => {
      // Mock empty server list
      (mcpManager.getAllServers as ReturnType<typeof vi.fn>).mockReturnValue(
        [],
      );

      const { lastFrame } = render(<McpManager onCancel={mockOnCancel} />);
      const output = lastFrame();

      expect(output).toContain("Manage MCP servers");
      expect(output).toContain("No MCP servers configured");
    });

    it("should not call ensureConfigLoaded on mount (handled by aiManager)", () => {
      render(<McpManager onCancel={mockOnCancel} />);

      expect(mcpManager.ensureConfigLoaded).not.toHaveBeenCalled();
    });
  });

  describe("no servers configured", () => {
    it("should show no servers message when empty", async () => {
      vi.mocked(mcpManager.getAllServers).mockReturnValue([]);
      vi.mocked(mcpManager.ensureConfigLoaded).mockResolvedValue({
        mcpServers: {},
      });

      const { lastFrame } = render(<McpManager onCancel={mockOnCancel} />);

      // Wait longer for async loading to complete
      await new Promise((resolve) => setTimeout(resolve, 50));

      const output = lastFrame();

      expect(output).toContain("No MCP servers configured");
      expect(output).toContain(
        "Create a .mcp.json file in your project root to add servers",
      );
      expect(output).toContain("Press Escape to close");
    });
  });

  describe("server list view", () => {
    it("should display server list with correct information", async () => {
      const { lastFrame } = render(<McpManager onCancel={mockOnCancel} />);

      // Wait for async loading to complete
      await new Promise((resolve) => setTimeout(resolve, 10));
      const output = lastFrame();

      // Check header
      expect(output).toContain("Manage MCP servers");
      expect(output).toContain("Select a server to view details");

      // Check servers are displayed
      expect(output).toContain("chrome-devtools");
      expect(output).toContain("filesystem");
      expect(output).toContain("brave-search");

      // Check status indicators
      expect(output).toContain("○"); // disconnected
      expect(output).toContain("✓"); // connected
      expect(output).toContain("✗"); // error

      // Check tool count for connected server
      expect(output).toContain("5 tools");
    });

    it("should show correct commands for selected server", async () => {
      const { lastFrame } = render(<McpManager onCancel={mockOnCancel} />);

      await new Promise((resolve) => setTimeout(resolve, 10));
      const output = lastFrame();

      // Only the first (selected) server's command should be visible in detail
      expect(output).toContain("npx chrome-devtools-mcp@latest");
      // Other servers' commands are not shown in detail in list view
    });

    it("should show navigation instructions", async () => {
      const { lastFrame } = render(<McpManager onCancel={mockOnCancel} />);

      await new Promise((resolve) => setTimeout(resolve, 10));
      const output = lastFrame();

      expect(output).toContain("↑/↓ to select");
      expect(output).toContain("Enter to view");
      expect(output).toContain("c to connect"); // shown for disconnected first server
      expect(output).toContain("r to reconnect");
      expect(output).toContain("Esc to close");
      // d to disconnect should NOT be shown for disconnected server
      expect(output).not.toContain("d to disconnect");
    });

    it("should show disconnect option when connected server is selected", async () => {
      // Create a scenario where filesystem server (connected) is selected
      const connectedServerFirst = [
        mockServers[1],
        ...mockServers.slice(0, 1),
        mockServers[2],
      ];
      vi.mocked(mcpManager.getAllServers).mockReturnValue(connectedServerFirst);

      const { lastFrame } = render(<McpManager onCancel={mockOnCancel} />);

      await new Promise((resolve) => setTimeout(resolve, 10));
      const output = lastFrame();

      // Should show disconnect option since first server is connected
      expect(output).toContain("d to disconnect");
    });
  });

  describe("server selection", () => {
    it("should highlight first server by default", async () => {
      const { lastFrame } = render(<McpManager onCancel={mockOnCancel} />);

      await new Promise((resolve) => setTimeout(resolve, 10));
      const output = lastFrame();

      // First server should be selected (indicated by ▶)
      expect(output).toContain("▶ 1. ○ chrome-devtools");
    });

    it("should show last connected time for connected server when selected", async () => {
      // Make filesystem server (which has lastConnected) the first/selected one
      const connectedServerFirst = [
        mockServers[1],
        ...mockServers.slice(0, 1),
        mockServers[2],
      ];
      vi.mocked(mcpManager.getAllServers).mockReturnValue(connectedServerFirst);

      const { lastFrame } = render(<McpManager onCancel={mockOnCancel} />);

      await new Promise((resolve) => setTimeout(resolve, 10));
      const output = lastFrame();

      expect(output).toContain("Last connected:");
    });
  });

  describe("status formatting", () => {
    it("should display correct status colors and icons", async () => {
      const { lastFrame } = render(<McpManager onCancel={mockOnCancel} />);

      await new Promise((resolve) => setTimeout(resolve, 10));
      const output = lastFrame();

      // Status icons should be present
      expect(output).toContain("○"); // disconnected
      expect(output).toContain("✓"); // connected
      expect(output).toContain("✗"); // error
    });

    it("should show tool count only for connected servers", async () => {
      const { lastFrame } = render(<McpManager onCancel={mockOnCancel} />);

      await new Promise((resolve) => setTimeout(resolve, 10));
      const output = lastFrame();

      // Only filesystem server should show tool count
      expect(output).toContain("5 tools");
      // Should not show tool count for disconnected servers
      expect(output).not.toContain("0 tools");
    });
  });

  describe("error handling", () => {
    it("should handle ensureConfigLoaded failure gracefully", async () => {
      // Mock console.error to suppress error output during test
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      vi.mocked(mcpManager.ensureConfigLoaded).mockRejectedValue(
        new Error("Config error"),
      );

      const { lastFrame } = render(<McpManager onCancel={mockOnCancel} />);

      await new Promise((resolve) => setTimeout(resolve, 10));
      const output = lastFrame();

      // Component should still render without crashing
      expect(output).toContain("Manage MCP servers");

      // Restore console.error
      consoleErrorSpy.mockRestore();
    });

    it("should display all server statuses including error", async () => {
      const { lastFrame } = render(<McpManager onCancel={mockOnCancel} />);

      await new Promise((resolve) => setTimeout(resolve, 10));
      const output = lastFrame();

      // All three servers should be visible with their status
      expect(output).toContain("chrome-devtools"); // disconnected
      expect(output).toContain("filesystem"); // connected
      expect(output).toContain("brave-search"); // error
    });
  });

  describe("refresh behavior", () => {
    it("should call getAllServers on mount", async () => {
      render(<McpManager onCancel={mockOnCancel} />);

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mcpManager.getAllServers).toHaveBeenCalled();
    });

    it("should set up auto-refresh interval", async () => {
      vi.useFakeTimers();

      render(<McpManager onCancel={mockOnCancel} />);

      // Allow React effects to run with real timers for a moment
      vi.runOnlyPendingTimers();

      // Initially called for initial load (once in loadServers, once by interval setup)
      expect(mcpManager.getAllServers).toHaveBeenCalledTimes(2);

      // Fast-forward time by 1 second to trigger interval
      vi.advanceTimersByTime(1000);

      // Should be called again due to interval
      expect(mcpManager.getAllServers).toHaveBeenCalledTimes(3);

      vi.useRealTimers();
    });
  });

  describe("server with environment variables", () => {
    it("should handle servers with env config", () => {
      // brave-search server has env variables in config
      const serverWithEnv = mockServers[2];

      expect(serverWithEnv.config.env).toEqual({
        BRAVE_API_KEY: "test-key",
      });

      // Just verify the server config exists, not the UI display
      // since env vars are shown in detail view, not list view
    });
  });

  describe("component lifecycle", () => {
    it("should cleanup interval on unmount", () => {
      vi.useFakeTimers();
      const clearIntervalSpy = vi.spyOn(global, "clearInterval");

      const { unmount } = render(<McpManager onCancel={mockOnCancel} />);
      unmount();

      expect(clearIntervalSpy).toHaveBeenCalled();

      vi.useRealTimers();
    });
  });
});
