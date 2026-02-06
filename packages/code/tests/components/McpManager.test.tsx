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
  let defaultProps: McpManagerProps;

  beforeEach(() => {
    mockOnCancel = vi.fn();
    mockOnConnectServer = vi.fn().mockResolvedValue(true);
    mockOnDisconnectServer = vi.fn().mockResolvedValue(true);

    defaultProps = {
      onCancel: mockOnCancel,
      servers: mockServers,
      onConnectServer: mockOnConnectServer,
      onDisconnectServer: mockOnDisconnectServer,
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
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

  describe("navigation", () => {
    it("should change selection with arrow keys", async () => {
      const { lastFrame, stdin } = render(<McpManager {...defaultProps} />);

      // Initially first server is selected
      expect(lastFrame()).toContain("▶ 1. ○ chrome-devtools");

      // Press down arrow
      stdin.write("\u001B[B");
      await vi.waitFor(() =>
        expect(lastFrame()).toContain("▶ 2. ✓ filesystem"),
      );

      // Press down arrow again
      stdin.write("\u001B[B");
      await vi.waitFor(() =>
        expect(lastFrame()).toContain("▶ 3. ✗ brave-search"),
      );

      // Press down arrow at the end (should stay at last)
      stdin.write("\u001B[B");
      await vi.waitFor(() =>
        expect(lastFrame()).toContain("▶ 3. ✗ brave-search"),
      );

      // Press up arrow
      stdin.write("\u001B[A");
      await vi.waitFor(() =>
        expect(lastFrame()).toContain("▶ 2. ✓ filesystem"),
      );

      // Press up arrow at the beginning (should stay at first)
      stdin.write("\u001B[A");
      await vi.waitFor(() =>
        expect(lastFrame()).toContain("▶ 1. ○ chrome-devtools"),
      );
    });

    it("should switch to detail view on Enter and back on Escape", async () => {
      const { lastFrame, stdin } = render(<McpManager {...defaultProps} />);

      // Press Enter to view details of first server
      stdin.write("\r");
      await vi.waitFor(() =>
        expect(lastFrame()).toContain("MCP Server Details: chrome-devtools"),
      );
      expect(lastFrame()).toContain("Status: ○ disconnected");

      // Press Escape to go back to list
      stdin.write("\u001B");
      await vi.waitFor(() =>
        expect(lastFrame()).toContain("Manage MCP servers"),
      );
      expect(lastFrame()).toContain("▶ 1. ○ chrome-devtools");
    });

    it("should call onCancel on Escape in list view", async () => {
      const { stdin } = render(<McpManager {...defaultProps} />);

      // Press Escape in list view
      stdin.write("\u001B");
      await vi.waitFor(() => expect(mockOnCancel).toHaveBeenCalled());
    });
  });

  describe("server actions", () => {
    it("should connect a disconnected server with 'c' key in list view", async () => {
      const { stdin } = render(<McpManager {...defaultProps} />);

      // First server is disconnected
      stdin.write("c");
      await vi.waitFor(() =>
        expect(mockOnConnectServer).toHaveBeenCalledWith("chrome-devtools"),
      );
    });

    it("should disconnect a connected server with 'd' key in list view", async () => {
      const { stdin, lastFrame } = render(<McpManager {...defaultProps} />);

      // Move to second server (connected)
      stdin.write("\u001B[B");
      await vi.waitFor(() =>
        expect(lastFrame()).toContain("▶ 2. ✓ filesystem"),
      );

      stdin.write("d");
      await vi.waitFor(() =>
        expect(mockOnDisconnectServer).toHaveBeenCalledWith("filesystem"),
      );
    });

    it("should connect/disconnect in detail view", async () => {
      const { stdin, lastFrame } = render(<McpManager {...defaultProps} />);

      // Go to detail view of first server (disconnected)
      stdin.write("\r");
      await vi.waitFor(() =>
        expect(lastFrame()).toContain("MCP Server Details: chrome-devtools"),
      );

      stdin.write("c");
      await vi.waitFor(() =>
        expect(mockOnConnectServer).toHaveBeenCalledWith("chrome-devtools"),
      );

      // Go back, move to second server (connected), go to detail
      stdin.write("\u001B");
      await vi.waitFor(() =>
        expect(lastFrame()).toContain("Manage MCP servers"),
      );

      stdin.write("\u001B[B");
      // Wait for selection to change
      await vi.waitFor(() =>
        expect(lastFrame()).toContain("▶ 2. ✓ filesystem"),
      );

      stdin.write("\r");
      await vi.waitFor(() =>
        expect(lastFrame()).toContain("MCP Server Details: filesystem"),
      );

      stdin.write("d");
      await vi.waitFor(() =>
        expect(mockOnDisconnectServer).toHaveBeenCalledWith("filesystem"),
      );
    });
  });

  describe("detail view content", () => {
    it("should display all server details", async () => {
      const fullServer: McpServerStatus = {
        name: "full-server",
        config: {
          command: "test-cmd",
          args: ["arg1", "arg2"],
          env: { KEY1: "VAL1", KEY2: "VAL2" },
        },
        status: "connected",
        toolCount: 10,
        capabilities: ["resources", "prompts"],
        lastConnected: new Date("2026-01-01T12:00:00Z").getTime(),
      };

      const { lastFrame, stdin } = render(
        <McpManager {...defaultProps} servers={[fullServer]} />,
      );

      // Go to detail view
      stdin.write("\r");
      await vi.waitFor(() =>
        expect(lastFrame()).toContain("MCP Server Details: full-server"),
      );
      const output = lastFrame();

      expect(output).toContain("Status: ✓ connected");
      expect(output).toContain("Command: test-cmd");
      expect(output).toContain("Args: arg1 arg2");
      expect(output).toContain("Tools: 10 tools");
      expect(output).toContain("Capabilities: resources, prompts");
      expect(output).toContain("Last Connected:");
      expect(output).toContain("Environment Variables:");
      expect(output).toContain("KEY1=VAL1");
      expect(output).toContain("KEY2=VAL2");
    });

    it("should display error message in detail view", async () => {
      const { lastFrame, stdin } = render(<McpManager {...defaultProps} />);

      // Move to third server (error)
      stdin.write("\u001B[B");
      await vi.waitFor(() =>
        expect(lastFrame()).toContain("▶ 2. ✓ filesystem"),
      );
      stdin.write("\u001B[B");
      await vi.waitFor(() =>
        expect(lastFrame()).toContain("▶ 3. ✗ brave-search"),
      );

      stdin.write("\r");
      await vi.waitFor(() =>
        expect(lastFrame()).toContain("MCP Server Details: brave-search"),
      );

      const output = lastFrame();
      expect(output).toContain("Status: ✗ error");
      expect(output).toContain("Error: Connection failed");
    });
  });

  describe("edge cases and status icons", () => {
    it("should handle server with no args or env", async () => {
      const minimalServer: McpServerStatus = {
        name: "minimal",
        config: { command: "min-cmd" },
        status: "disconnected",
      };

      const { lastFrame, stdin } = render(
        <McpManager {...defaultProps} servers={[minimalServer]} />,
      );

      stdin.write("\r");
      await vi.waitFor(() =>
        expect(lastFrame()).toContain("MCP Server Details: minimal"),
      );
      const output = lastFrame();
      expect(output).not.toContain("Args:");
      expect(output).not.toContain("Environment Variables:");
    });

    it("should show connecting status icon", () => {
      const connectingServer: McpServerStatus = {
        name: "connecting-server",
        config: { command: "cmd" },
        status: "connecting",
      };

      const { lastFrame } = render(
        <McpManager {...defaultProps} servers={[connectingServer]} />,
      );

      expect(lastFrame()).toContain("⟳");
    });
  });
});
