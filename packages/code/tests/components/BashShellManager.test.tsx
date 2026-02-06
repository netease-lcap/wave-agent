import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { BashShellManager } from "../../src/components/BashShellManager.js";
import { ChatProvider } from "../../src/contexts/useChat.js";
import { AppProvider } from "../../src/contexts/useAppConfig.js";
import { Agent, type BackgroundShell } from "wave-agent-sdk";

// Mock useAppConfig
vi.mock("../../src/contexts/useAppConfig.js", async () => {
  const actual = await vi.importActual("../../src/contexts/useAppConfig.js");
  return {
    ...actual,
    useAppConfig: vi.fn(() => ({
      restoreSessionId: undefined,
      continueLastSession: false,
    })),
  };
});

// Mock wave-agent-sdk
vi.mock("wave-agent-sdk", async () => {
  const actual = await vi.importActual("wave-agent-sdk");
  return {
    ...actual,
    Agent: {
      create: vi.fn(),
    },
  };
});

describe("BashShellManager", () => {
  const mockShells: Partial<BackgroundShell>[] = [
    {
      id: "shell-1",
      command: "ls -la",
      status: "running" as const,
      startTime: Date.now() - 5000,
      stdout: "file1.txt\nfile2.txt",
      stderr: "",
    },
    {
      id: "shell-2",
      command: "npm test",
      status: "completed" as const,
      startTime: Date.now() - 10000,
      exitCode: 0,
      runtime: 2000,
      stdout: "All tests passed",
      stderr: "",
    },
  ];

  const mockAgent = {
    sessionId: "test-session",
    messages: [],
    backgroundShells: mockShells,
    getBackgroundShellOutput: vi.fn((id) => {
      const shell = mockShells.find((s) => s.id === id);
      return shell
        ? {
            stdout: shell.stdout || "",
            stderr: shell.stderr || "",
            status: shell.status || "running",
          }
        : null;
    }),
    killBackgroundShell: vi.fn(),
    // Add other required agent properties
    getPermissionMode: vi.fn(() => "default"),
    getMcpServers: vi.fn(() => []),
    getSlashCommands: vi.fn(() => []),
    destroy: vi.fn(),
    isLoading: false,
    latestTotalTokens: 0,
    isCommandRunning: false,
    isCompressing: false,
    userInputHistory: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(Agent.create).mockResolvedValue(mockAgent as unknown as Agent);
  });

  it("should render the list of background shells", async () => {
    const { lastFrame } = render(
      <AppProvider>
        <ChatProvider>
          <BashShellManager onCancel={vi.fn()} />
        </ChatProvider>
      </AppProvider>,
    );

    await vi.waitFor(() => {
      expect(Agent.create).toHaveBeenCalled();
    });

    const agentCreateArgs = vi.mocked(Agent.create).mock.calls[0][0];
    const callbacks = agentCreateArgs.callbacks!;
    callbacks.onShellsChange!(mockShells as unknown as BackgroundShell[]);

    await vi.waitFor(() => {
      const output = lastFrame();
      expect(output).toContain("Background Bash Shells");
      expect(output).toContain("ls -la");
      expect(output).toContain("npm test");
      expect(output).toContain("(running)");
      expect(output).toContain("(completed)");
    });
  });

  it("should navigate the list and show details", async () => {
    const { lastFrame, stdin } = render(
      <AppProvider>
        <ChatProvider>
          <BashShellManager onCancel={vi.fn()} />
        </ChatProvider>
      </AppProvider>,
    );

    await vi.waitFor(() => {
      expect(Agent.create).toHaveBeenCalled();
    });

    const agentCreateArgs = vi.mocked(Agent.create).mock.calls[0][0];
    const callbacks = agentCreateArgs.callbacks!;
    callbacks.onShellsChange!(mockShells as unknown as BackgroundShell[]);

    await vi.waitFor(() => {
      expect(lastFrame()).toContain("ls -la");
    });

    // Navigate to second shell
    stdin.write("\u001B[B"); // Down arrow

    await vi.waitFor(() => {
      expect(lastFrame()).toContain("▶ 2. npm test");
    });

    // Press Enter to view details
    stdin.write("\r");

    await vi.waitFor(() => {
      const output = lastFrame();
      expect(output).toContain("Background Shell Details: shell-2");
      expect(output).toContain("Command: npm test");
      expect(output).toContain("STDOUT (last 10 lines):");
      expect(output).toContain("All tests passed");
    });
  });

  it("should call onCancel when Escape is pressed in list mode", async () => {
    const onCancel = vi.fn();
    const { stdin } = render(
      <AppProvider>
        <ChatProvider>
          <BashShellManager onCancel={onCancel} />
        </ChatProvider>
      </AppProvider>,
    );

    await vi.waitFor(() => {
      expect(Agent.create).toHaveBeenCalled();
    });

    const agentCreateArgs = vi.mocked(Agent.create).mock.calls[0][0];
    const callbacks = agentCreateArgs.callbacks!;
    callbacks.onShellsChange!(mockShells as unknown as BackgroundShell[]);

    await vi.waitFor(() => {
      expect(onCancel).not.toHaveBeenCalled();
    });

    stdin.write("\u001B"); // Escape

    await vi.waitFor(() => {
      expect(onCancel).toHaveBeenCalled();
    });
  });

  it("should go back to list mode when Escape is pressed in detail mode", async () => {
    const { lastFrame, stdin } = render(
      <AppProvider>
        <ChatProvider>
          <BashShellManager onCancel={vi.fn()} />
        </ChatProvider>
      </AppProvider>,
    );

    await vi.waitFor(() => {
      expect(Agent.create).toHaveBeenCalled();
    });

    const agentCreateArgs = vi.mocked(Agent.create).mock.calls[0][0];
    const callbacks = agentCreateArgs.callbacks!;
    callbacks.onShellsChange!(mockShells as unknown as BackgroundShell[]);

    await vi.waitFor(() => {
      expect(lastFrame()).toContain("ls -la");
    });

    stdin.write("\r"); // Enter detail mode

    await vi.waitFor(() => {
      expect(lastFrame()).toContain("Background Shell Details");
    });

    stdin.write("\u001B"); // Escape

    await vi.waitFor(() => {
      expect(lastFrame()).toContain("Background Bash Shells");
      expect(lastFrame()).not.toContain("Background Shell Details");
    });
  });

  it("should kill a running shell with 'k' key", async () => {
    const { lastFrame, stdin } = render(
      <AppProvider>
        <ChatProvider>
          <BashShellManager onCancel={vi.fn()} />
        </ChatProvider>
      </AppProvider>,
    );

    await vi.waitFor(() => {
      expect(Agent.create).toHaveBeenCalled();
    });

    const agentCreateArgs = vi.mocked(Agent.create).mock.calls[0][0];
    const callbacks = agentCreateArgs.callbacks!;
    callbacks.onShellsChange!(mockShells as unknown as BackgroundShell[]);

    await vi.waitFor(() => {
      expect(lastFrame()).toContain("ls -la");
    });

    stdin.write("k");

    await vi.waitFor(() => {
      expect(mockAgent.killBackgroundShell).toHaveBeenCalledWith("shell-1");
    });
  });
});
