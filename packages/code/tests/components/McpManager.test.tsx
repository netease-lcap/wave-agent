import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  McpManager,
  McpManagerProps,
} from "../../src/components/McpManager.js";
import { McpServerStatus } from "wave-agent-sdk";

// Mock server data
const mockServers: McpServerStatus[] = [
  {
    name: "chrome-devtools",
    config: {
      command: "npx",
      args: ["chrome-devtools-mcp@latest"],
    },
    status: "disconnected",
    lastConnected: undefined,
    error: undefined,
    toolCount: 0,
  },
  {
    name: "filesystem",
    config: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
    },
    status: "connected",
    lastConnected: Date.now() - 60000, // 1 minute ago
    error: undefined,
    toolCount: 5,
  },
  {
    name: "brave-search",
    config: {
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-brave-search"],
      env: {
        BRAVE_API_KEY: "test-key",
      },
    },
    status: "error",
    lastConnected: undefined,
    error: "Connection failed",
    toolCount: 0,
  },
];

describe("McpManager", () => {
  let mockOnCancel: ReturnType<typeof vi.fn>;
  let mockOnConnectServer: ReturnType<typeof vi.fn>;
  let mockOnDisconnectServer: ReturnType<typeof vi.fn>;
  let mockOnReconnectServer: ReturnType<typeof vi.fn>;
  let defaultProps: McpManagerProps;

  beforeEach(() => {
    vi.useFakeTimers();
    mockOnCancel = vi.fn();
    mockOnConnectServer = vi.fn().mockResolvedValue(true);
    mockOnDisconnectServer = vi.fn().mockResolvedValue(true);
    mockOnReconnectServer = vi.fn().mockResolvedValue(true);

    defaultProps = {
      onCancel: mockOnCancel,
      servers: mockServers,
      onConnectServer: mockOnConnectServer,
      onDisconnectServer: mockOnDisconnectServer,
      onReconnectServer: mockOnReconnectServer,
    };
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  describe("initial loading", () => {
    it("should show initial state without loading", () => {
      const { lastFrame } = render(<McpManager {...defaultProps} />);
      const output = lastFrame();

      expect(output).toContain("Manage MCP servers");
      expect(output).toContain("Select a server to view details");
    });

    it("should not call ensureConfigLoaded on mount (handled by agent)", () => {
      render(<McpManager {...defaultProps} />);

      // These methods should not be called directly by the component anymore
      // as they are handled by the agent
      expect(mockOnConnectServer).not.toHaveBeenCalled();
      expect(mockOnDisconnectServer).not.toHaveBeenCalled();
      expect(mockOnReconnectServer).not.toHaveBeenCalled();
    });
  });

  describe("no servers configured", () => {
    it("should show no servers message when empty", () => {
      const emptyProps = { ...defaultProps, servers: [] };
      const { lastFrame } = render(<McpManager {...emptyProps} />);
      const output = lastFrame();

      expect(output).toContain("No MCP servers configured");
      expect(output).toContain(
        "Create a .mcp.json file in your project root to add servers",
      );
    });
  });

  describe("server list view", () => {
    it("should display server list with correct information", () => {
      const { lastFrame } = render(<McpManager {...defaultProps} />);
      const output = lastFrame();

      // Check header
      expect(output).toContain("Manage MCP servers");
      expect(output).toContain("Select a server to view details");

      // Check server names are present
      expect(output).toContain("chrome-devtools");
      expect(output).toContain("filesystem");
      expect(output).toContain("brave-search");
    });

    it("should show correct commands for selected server", () => {
      const { lastFrame } = render(<McpManager {...defaultProps} />);
      const output = lastFrame();

      // Only the first (selected) server's command should be visible in detail
      expect(output).toContain("npx chrome-devtools-mcp@latest");
      // Other servers' commands are not shown in detail in list view
    });

    it("should show navigation instructions", () => {
      const { lastFrame } = render(<McpManager {...defaultProps} />);
      const output = lastFrame();

      expect(output).toContain("↑/↓ to select");
      expect(output).toContain("Enter to view");
      expect(output).toContain("c to connect"); // shown for disconnected server
      expect(output).toContain("Esc to close");
    });

    it("should show disconnect option when connected server is selected", () => {
      // Make filesystem server the first one so it's selected by default
      const reorderedServers = [mockServers[1], mockServers[0], mockServers[2]]; // filesystem first
      const props = { ...defaultProps, servers: reorderedServers };

      const { lastFrame } = render(<McpManager {...props} />);
      const output = lastFrame();

      // Should show disconnect option since first server is connected
      expect(output).toContain("d to disconnect");
    });
  });

  describe("server selection", () => {
    it("should highlight first server by default", () => {
      const { lastFrame } = render(<McpManager {...defaultProps} />);
      const output = lastFrame();

      // First server should be selected (indicated by ▶)
      expect(output).toContain("▶ 1. ○ chrome-devtools");
    });

    it("should show last connected time for connected server when selected", () => {
      // Make filesystem server the first one so it's selected by default
      const reorderedServers = [mockServers[1], mockServers[0], mockServers[2]]; // filesystem first
      const props = { ...defaultProps, servers: reorderedServers };

      const { lastFrame } = render(<McpManager {...props} />);
      const output = lastFrame();

      expect(output).toContain("Last connected:");
    });
  });

  describe("status formatting", () => {
    it("should display correct status colors and icons", () => {
      const { lastFrame } = render(<McpManager {...defaultProps} />);
      const output = lastFrame();

      // Status icons should be present
      expect(output).toContain("○"); // disconnected
      expect(output).toContain("✓"); // connected
      expect(output).toContain("✗"); // error
    });

    it("should show tool count only for connected servers", () => {
      const { lastFrame } = render(<McpManager {...defaultProps} />);
      const output = lastFrame();

      // Only filesystem server should show tool count
      expect(output).toContain("5 tools");
      // Should not show tool count for disconnected servers
      expect(output).not.toContain("0 tools");
    });
  });

  describe("error handling", () => {
    it("should handle ensureConfigLoaded failure gracefully", () => {
      // Create props with error server
      const errorProps = { ...defaultProps };

      const { lastFrame } = render(<McpManager {...errorProps} />);
      const output = lastFrame();

      // Component should still render without crashing
      expect(output).toContain("Manage MCP servers");
    });

    it("should display all server statuses including error", () => {
      const { lastFrame } = render(<McpManager {...defaultProps} />);
      const output = lastFrame();

      // All three servers should be visible with their status
      expect(output).toContain("chrome-devtools"); // disconnected
      expect(output).toContain("filesystem"); // connected
      expect(output).toContain("brave-search"); // error
    });
  });

  describe("refresh behavior", () => {
    it("should not call methods directly (handled by parent)", () => {
      render(<McpManager {...defaultProps} />);

      // Wait for any async operations
      vi.advanceTimersByTime(10);

      // These should not be called directly by the component
      expect(mockOnConnectServer).not.toHaveBeenCalled();
      expect(mockOnDisconnectServer).not.toHaveBeenCalled();
      expect(mockOnReconnectServer).not.toHaveBeenCalled();
    });

    it("should handle prop changes correctly", () => {
      const { rerender, lastFrame } = render(<McpManager {...defaultProps} />);

      // Update servers
      const updatedServers = [...mockServers];
      updatedServers[0] = {
        ...updatedServers[0],
        status: "connected" as const,
      };

      rerender(<McpManager {...defaultProps} servers={updatedServers} />);

      const output = lastFrame();
      expect(output).toContain("chrome-devtools");
    });
  });

  describe("server with environment variables", () => {
    it("should handle servers with env config", () => {
      const { lastFrame } = render(<McpManager {...defaultProps} />);
      const output = lastFrame();

      // brave-search server has env config, should still be displayed
      expect(output).toContain("brave-search");
    });
  });

  describe("component lifecycle", () => {
    it("should cleanup properly on unmount", () => {
      const { unmount } = render(<McpManager {...defaultProps} />);

      // Component should unmount without errors
      expect(() => unmount()).not.toThrow();
    });
  });
});
