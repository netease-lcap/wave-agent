import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TaskManager } from "../../src/components/TaskManager.js";
import { ChatProvider } from "../../src/contexts/useChat.js";
import { AppProvider } from "../../src/contexts/useAppConfig.js";
import { Agent, type BackgroundTask } from "wave-agent-sdk";

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

describe("TaskManager", () => {
  const mockTasks: Partial<BackgroundTask>[] = [
    {
      id: "task-1",
      type: "shell" as const,
      command: "ls -la",
      description: "ls -la",
      status: "running" as const,
      startTime: Date.now() - 5000,
      stdout: "file1.txt\nfile2.txt",
      stderr: "",
    },
    {
      id: "task-2",
      type: "shell" as const,
      command: "npm test",
      description: "npm test",
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
    backgroundTasks: mockTasks,
    getBackgroundTaskOutput: vi.fn((id) => {
      const task = mockTasks.find((t) => t.id === id);
      return task
        ? {
            stdout: task.stdout || "",
            stderr: task.stderr || "",
            status: task.status || "running",
          }
        : null;
    }),
    stopBackgroundTask: vi.fn(),
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

  it("should render the list of background tasks", async () => {
    const { lastFrame } = render(
      <AppProvider>
        <ChatProvider>
          <TaskManager onCancel={vi.fn()} />
        </ChatProvider>
      </AppProvider>,
    );

    await vi.waitFor(() => {
      expect(Agent.create).toHaveBeenCalled();
    });

    const agentCreateArgs = vi.mocked(Agent.create).mock.calls[0][0];
    const callbacks = agentCreateArgs.callbacks!;
    callbacks.onTasksChange!(mockTasks as unknown as BackgroundTask[]);

    await vi.waitFor(() => {
      const output = lastFrame();
      expect(output).toContain("Background Tasks");
      expect(output).toContain("[task-1] shell: ls -la");
      expect(output).toContain("[task-2] shell: npm test");
      expect(output).toContain("(running)");
      expect(output).toContain("(completed)");
    });
  });

  it("should navigate the list and show details", async () => {
    const { lastFrame, stdin } = render(
      <AppProvider>
        <ChatProvider>
          <TaskManager onCancel={vi.fn()} />
        </ChatProvider>
      </AppProvider>,
    );

    await vi.waitFor(() => {
      expect(Agent.create).toHaveBeenCalled();
    });

    const agentCreateArgs = vi.mocked(Agent.create).mock.calls[0][0];
    const callbacks = agentCreateArgs.callbacks!;
    callbacks.onTasksChange!(mockTasks as unknown as BackgroundTask[]);

    await vi.waitFor(() => {
      expect(lastFrame()).toContain("[task-1] shell: ls -la");
    });

    // Navigate to second task
    stdin.write("\u001B[B"); // Down arrow

    await vi.waitFor(() => {
      expect(lastFrame()).toContain("▶ 2. [task-2] shell: npm test");
    });

    // Press Enter to view details
    stdin.write("\r");

    await vi.waitFor(() => {
      const output = lastFrame();
      expect(output).toContain("Background Task Details: task-2");
      expect(output).toContain("Description: npm test");
      expect(output).toContain("OUTPUT (last 10 lines):");
      expect(output).toContain("All tests passed");
    });
  });

  it("should call onCancel when Escape is pressed in list mode", async () => {
    const onCancel = vi.fn();
    const { stdin } = render(
      <AppProvider>
        <ChatProvider>
          <TaskManager onCancel={onCancel} />
        </ChatProvider>
      </AppProvider>,
    );

    await vi.waitFor(() => {
      expect(Agent.create).toHaveBeenCalled();
    });

    const agentCreateArgs = vi.mocked(Agent.create).mock.calls[0][0];
    const callbacks = agentCreateArgs.callbacks!;
    callbacks.onTasksChange!(mockTasks as unknown as BackgroundTask[]);

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
          <TaskManager onCancel={vi.fn()} />
        </ChatProvider>
      </AppProvider>,
    );

    await vi.waitFor(() => {
      expect(Agent.create).toHaveBeenCalled();
    });

    const agentCreateArgs = vi.mocked(Agent.create).mock.calls[0][0];
    const callbacks = agentCreateArgs.callbacks!;
    callbacks.onTasksChange!(mockTasks as unknown as BackgroundTask[]);

    await vi.waitFor(() => {
      expect(lastFrame()).toContain("[task-1] shell: ls -la");
    });

    stdin.write("\r"); // Enter detail mode

    await vi.waitFor(() => {
      expect(lastFrame()).toContain("Background Task Details");
    });

    stdin.write("\u001B"); // Escape

    await vi.waitFor(() => {
      expect(lastFrame()).toContain("Background Tasks");
      expect(lastFrame()).not.toContain("Background Task Details");
    });
  });

  it("should stop a running task with 'k' key", async () => {
    const { lastFrame, stdin } = render(
      <AppProvider>
        <ChatProvider>
          <TaskManager onCancel={vi.fn()} />
        </ChatProvider>
      </AppProvider>,
    );

    await vi.waitFor(() => {
      expect(Agent.create).toHaveBeenCalled();
    });

    const agentCreateArgs = vi.mocked(Agent.create).mock.calls[0][0];
    const callbacks = agentCreateArgs.callbacks!;
    callbacks.onTasksChange!(mockTasks as unknown as BackgroundTask[]);

    await vi.waitFor(() => {
      expect(lastFrame()).toContain("[task-1] shell: ls -la");
    });

    stdin.write("k");

    await vi.waitFor(() => {
      expect(mockAgent.stopBackgroundTask).toHaveBeenCalledWith("task-1");
    });
  });

  it("should handle empty background tasks", async () => {
    vi.mocked(Agent.create).mockResolvedValue({
      ...mockAgent,
      backgroundTasks: [],
    } as unknown as Agent);

    const { lastFrame } = render(
      <AppProvider>
        <ChatProvider>
          <TaskManager onCancel={vi.fn()} />
        </ChatProvider>
      </AppProvider>,
    );

    await vi.waitFor(() => {
      expect(lastFrame()).toContain("No background tasks found");
    });
  });

  it("should handle null background tasks", async () => {
    const { lastFrame } = render(
      <AppProvider>
        <ChatProvider>
          <TaskManager onCancel={vi.fn()} />
        </ChatProvider>
      </AppProvider>,
    );

    await vi.waitFor(() => {
      expect(Agent.create).toHaveBeenCalled();
    });

    const agentCreateArgs = vi.mocked(Agent.create).mock.calls[0][0];
    const callbacks = agentCreateArgs.callbacks!;
    callbacks.onTasksChange!([] as unknown as BackgroundTask[]);

    await vi.waitFor(() => {
      expect(lastFrame()).toContain("No background tasks found");
    });
  });

  it("should format duration correctly", async () => {
    const tasksWithDifferentDurations: Partial<BackgroundTask>[] = [
      {
        id: "task-ms",
        type: "shell" as const,
        status: "completed" as const,
        startTime: Date.now(),
        runtime: 500,
      },
      {
        id: "task-s",
        type: "shell" as const,
        status: "completed" as const,
        startTime: Date.now(),
        runtime: 5000,
      },
      {
        id: "task-m",
        type: "shell" as const,
        status: "completed" as const,
        startTime: Date.now(),
        runtime: 65000,
      },
    ];

    const { lastFrame, stdin } = render(
      <AppProvider>
        <ChatProvider>
          <TaskManager onCancel={vi.fn()} />
        </ChatProvider>
      </AppProvider>,
    );

    await vi.waitFor(() => {
      expect(Agent.create).toHaveBeenCalled();
    });

    const agentCreateArgs = vi.mocked(Agent.create).mock.calls[0][0];
    const callbacks = agentCreateArgs.callbacks!;
    callbacks.onTasksChange!(
      tasksWithDifferentDurations as unknown as BackgroundTask[],
    );

    await vi.waitFor(() => {
      expect(lastFrame()).toContain("task-ms");
    });

    // Check first task (selected)
    expect(lastFrame()).toContain("500ms");

    // Select second task
    stdin.write("\u001B[B");
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("5s");
    });

    // Select third task
    stdin.write("\u001B[B");
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("1m 5s");
    });
  });

  it("should handle task not found in detail mode", async () => {
    const { lastFrame, stdin } = render(
      <AppProvider>
        <ChatProvider>
          <TaskManager onCancel={vi.fn()} />
        </ChatProvider>
      </AppProvider>,
    );

    await vi.waitFor(() => {
      expect(Agent.create).toHaveBeenCalled();
    });

    const agentCreateArgs = vi.mocked(Agent.create).mock.calls[0][0];
    const callbacks = agentCreateArgs.callbacks!;
    callbacks.onTasksChange!(mockTasks as unknown as BackgroundTask[]);

    await vi.waitFor(() => {
      expect(lastFrame()).toContain("[task-1] shell: ls -la");
    });

    // Enter detail mode
    stdin.write("\r");

    await vi.waitFor(() => {
      expect(lastFrame()).toContain("Background Task Details");
    });

    // Simulate task being removed
    callbacks.onTasksChange!([]);

    await vi.waitFor(() => {
      expect(lastFrame()).toContain("No background tasks found");
    });
  });

  it("should handle task with no description", async () => {
    const taskNoDesc: Partial<BackgroundTask>[] = [
      {
        id: "task-no-desc",
        type: "shell" as const,
        status: "running" as const,
        startTime: Date.now(),
      },
    ];

    const { lastFrame } = render(
      <AppProvider>
        <ChatProvider>
          <TaskManager onCancel={vi.fn()} />
        </ChatProvider>
      </AppProvider>,
    );

    await vi.waitFor(() => {
      expect(Agent.create).toHaveBeenCalled();
    });

    const agentCreateArgs = vi.mocked(Agent.create).mock.calls[0][0];
    const callbacks = agentCreateArgs.callbacks!;
    callbacks.onTasksChange!(taskNoDesc as unknown as BackgroundTask[]);

    await vi.waitFor(() => {
      expect(lastFrame()).toContain("[task-no-desc] shell");
      expect(lastFrame()).not.toContain(": undefined");
    });
  });

  it("should stop task from detail mode", async () => {
    const { lastFrame, stdin } = render(
      <AppProvider>
        <ChatProvider>
          <TaskManager onCancel={vi.fn()} />
        </ChatProvider>
      </AppProvider>,
    );

    await vi.waitFor(() => {
      expect(Agent.create).toHaveBeenCalled();
    });

    const agentCreateArgs = vi.mocked(Agent.create).mock.calls[0][0];
    const callbacks = agentCreateArgs.callbacks!;
    callbacks.onTasksChange!(mockTasks as unknown as BackgroundTask[]);

    await vi.waitFor(() => {
      expect(lastFrame()).toContain("[task-1]");
    });

    // Wait for state update to settle
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("[task-1]");
    });
    // Enter detail mode for task-1 (running)
    stdin.write("\r");

    await vi.waitFor(() => {
      expect(lastFrame()).toContain("Background Task Details: task-1");
    });

    stdin.write("k");

    await vi.waitFor(() => {
      expect(mockAgent.stopBackgroundTask).toHaveBeenCalledWith("task-1");
    });
  });

  it("should navigate with up/down arrows", async () => {
    const { lastFrame, stdin } = render(
      <AppProvider>
        <ChatProvider>
          <TaskManager onCancel={vi.fn()} />
        </ChatProvider>
      </AppProvider>,
    );

    await vi.waitFor(() => {
      expect(Agent.create).toHaveBeenCalled();
    });

    const agentCreateArgs = vi.mocked(Agent.create).mock.calls[0][0];
    const callbacks = agentCreateArgs.callbacks!;
    callbacks.onTasksChange!(mockTasks as unknown as BackgroundTask[]);

    await vi.waitFor(() => {
      expect(lastFrame()).toContain("[task-1]");
    });

    // Wait for state update to settle
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("[task-1]");
    });
    // Down arrow
    stdin.write("\u001B[B");
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("▶ 2.");
    });

    // Up arrow
    stdin.write("\u001B[A");
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("▶ 1.");
    });
  });
});
