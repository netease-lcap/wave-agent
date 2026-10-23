import React from "react";
import { render as originalRender } from "../helpers/inkHarness.js";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

let unmounts: Array<() => void> = [];
const render = (tree: React.ReactElement) => {
  const result = originalRender(tree);
  unmounts.push(result.unmount);
  return result;
};
import { BackgroundTaskManager } from "../../src/components/BackgroundTaskManager.js";
import { ChatProvider } from "../../src/contexts/useChat.js";
import { AppProvider } from "../../src/contexts/useAppConfig.js";
import { Agent, type BackgroundTask, type WorkflowRun } from "wave-agent-sdk";

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

describe("BackgroundTaskManager", () => {
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
    // 整条展示流现在由 SDK 读转录给出（缓存只剩一页）。
    backgroundTasks: mockTasks,
    getBackgroundTaskOutput: vi.fn((id) => {
      const task = [
        ...mockTasks,
        {
          id: "task-log",
          type: "shell" as const,
          status: "running" as const,
          startTime: Date.now(),
          outputPath: "/tmp/test.log",
        },
      ].find((t) => t.id === id);
      return task
        ? {
            stdout: task.stdout || "",
            stderr: task.stderr || "",
            status: task.status || "running",
            outputPath: task.outputPath,
          }
        : null;
    }),
    stopBackgroundTask: vi.fn(),
    getPermissionMode: vi.fn(() => "default"),
    getMcpServers: vi.fn(() => []),
    getSlashCommands: vi.fn(() => []),
    getHooksByScope: vi.fn(async () => ({})),
    destroy: vi.fn(),
    isLoading: false,
    latestTotalTokens: 0,
    isCommandRunning: false,
    isCompacting: false,
    userInputHistory: [],
    getModelConfig: vi.fn(() => ({
      model: "test-model",
      fastModel: "test-fast-model",
    })),
    getConfiguredModels: vi.fn(() => []),
    getGatewayConfig: vi.fn(() => ({ serverUrl: "http://localhost:8080" })),
    getMaxInputTokens: vi.fn(() => 128000),
    getWorkflowRuns: vi.fn(() => []),
  };

  it("should display the log file path if available", async () => {
    const taskWithLog: Partial<BackgroundTask>[] = [
      {
        id: "task-log",
        type: "shell" as const,
        status: "running" as const,
        startTime: Date.now(),
        outputPath: "/tmp/test.log",
      },
    ];

    const { lastFrame, stdin } = render(
      <AppProvider>
        <ChatProvider>
          <BackgroundTaskManager onCancel={vi.fn()} />
        </ChatProvider>
      </AppProvider>,
    );

    await vi.waitFor(() => {
      expect(Agent.create).toHaveBeenCalled();
    });

    const agentCreateArgs = vi.mocked(Agent.create).mock.calls[0][0];
    const callbacks = agentCreateArgs.callbacks!;
    callbacks.onBackgroundTasksChange!(
      taskWithLog as unknown as BackgroundTask[],
    );

    await vi.waitFor(() => {
      const output = lastFrame();
      expect(output).toContain("Log File: /tmp/test.log");
    });

    // Check detail view
    stdin.write("\r");
    await vi.waitFor(() => {
      const output = lastFrame();
      expect(output).toContain("Background Task Details: task-log");
      expect(output).toContain("Log File: /tmp/test.log");
    });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(Agent.create).mockResolvedValue(mockAgent as unknown as Agent);
  });

  afterEach(() => {
    unmounts.forEach((u) => u());
    unmounts = [];
  });

  it("should render the list of background tasks", async () => {
    const { lastFrame } = render(
      <AppProvider>
        <ChatProvider>
          <BackgroundTaskManager onCancel={vi.fn()} />
        </ChatProvider>
      </AppProvider>,
    );

    await vi.waitFor(() => {
      expect(Agent.create).toHaveBeenCalled();
    });

    const agentCreateArgs = vi.mocked(Agent.create).mock.calls[0][0];
    const callbacks = agentCreateArgs.callbacks!;
    callbacks.onBackgroundTasksChange!(
      mockTasks as unknown as BackgroundTask[],
    );

    await vi.waitFor(() => {
      const output = lastFrame();
      expect(output).toContain("Background Tasks");
      expect(output).toContain("[task-1] shell: ls -la");
      expect(output).toContain("[task-2] shell: npm test");
    });
  });

  it("should navigate the list and show details", async () => {
    const { lastFrame, stdin } = render(
      <AppProvider>
        <ChatProvider>
          <BackgroundTaskManager onCancel={vi.fn()} />
        </ChatProvider>
      </AppProvider>,
    );

    await vi.waitFor(() => {
      expect(Agent.create).toHaveBeenCalled();
    });

    const agentCreateArgs = vi.mocked(Agent.create).mock.calls[0][0];
    const callbacks = agentCreateArgs.callbacks!;
    callbacks.onBackgroundTasksChange!(
      mockTasks as unknown as BackgroundTask[],
    );

    await vi.waitFor(() => expect(lastFrame()).toContain("[task-1]"));

    stdin.write("\u001B[B"); // Down arrow
    await vi.waitFor(() => expect(lastFrame()).toContain("▶ 2."));

    stdin.write("\r"); // Enter

    await vi.waitFor(() => {
      const output = lastFrame();
      expect(output).toContain("Background Task Details: task-2");
      expect(output).toContain("All tests passed");
    });
  });

  it("should call onCancel when Escape is pressed in list mode", async () => {
    const onCancel = vi.fn();
    const { stdin } = render(
      <AppProvider>
        <ChatProvider>
          <BackgroundTaskManager onCancel={onCancel} />
        </ChatProvider>
      </AppProvider>,
    );

    await vi.waitFor(() => {
      expect(Agent.create).toHaveBeenCalled();
    });

    const agentCreateArgs = vi.mocked(Agent.create).mock.calls[0][0];
    const callbacks = agentCreateArgs.callbacks!;
    callbacks.onBackgroundTasksChange!(
      mockTasks as unknown as BackgroundTask[],
    );

    await vi.waitFor(() => expect(Agent.create).toHaveBeenCalled());

    stdin.write("\u001B"); // Escape

    await vi.waitFor(() => {
      expect(onCancel).toHaveBeenCalled();
    });
  });

  it("should go back to list mode when Escape is pressed in detail mode", async () => {
    const { lastFrame, stdin } = render(
      <AppProvider>
        <ChatProvider>
          <BackgroundTaskManager onCancel={vi.fn()} />
        </ChatProvider>
      </AppProvider>,
    );

    await vi.waitFor(() => {
      expect(Agent.create).toHaveBeenCalled();
    });

    const agentCreateArgs = vi.mocked(Agent.create).mock.calls[0][0];
    const callbacks = agentCreateArgs.callbacks!;
    callbacks.onBackgroundTasksChange!(
      mockTasks as unknown as BackgroundTask[],
    );

    await vi.waitFor(() => expect(lastFrame()).toContain("[task-1]"));

    stdin.write("\r");
    await vi.waitFor(() =>
      expect(lastFrame()).toContain("Background Task Details"),
    );

    stdin.write("\u001B");

    await vi.waitFor(() => {
      expect(lastFrame()).toContain("Background Tasks");
      expect(lastFrame()).not.toContain("Background Task Details");
    });
  });

  it("should stop a running task with 'k' key", async () => {
    const { lastFrame, stdin } = render(
      <AppProvider>
        <ChatProvider>
          <BackgroundTaskManager onCancel={vi.fn()} />
        </ChatProvider>
      </AppProvider>,
    );

    await vi.waitFor(() => {
      expect(Agent.create).toHaveBeenCalled();
    });

    const agentCreateArgs = vi.mocked(Agent.create).mock.calls[0][0];
    const callbacks = agentCreateArgs.callbacks!;
    callbacks.onBackgroundTasksChange!(
      mockTasks as unknown as BackgroundTask[],
    );

    await vi.waitFor(() => expect(lastFrame()).toContain("[task-1]"));

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
          <BackgroundTaskManager onCancel={vi.fn()} />
        </ChatProvider>
      </AppProvider>,
    );

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
          <BackgroundTaskManager onCancel={vi.fn()} />
        </ChatProvider>
      </AppProvider>,
    );

    await vi.waitFor(() => {
      expect(Agent.create).toHaveBeenCalled();
    });

    const agentCreateArgs = vi.mocked(Agent.create).mock.calls[0][0];
    const callbacks = agentCreateArgs.callbacks!;
    callbacks.onBackgroundTasksChange!(
      tasksWithDifferentDurations as unknown as BackgroundTask[],
    );

    await vi.waitFor(() => {
      expect(lastFrame()).toContain("500ms");
    });

    stdin.write("\u001B[B"); // task-s
    await vi.waitFor(() => expect(lastFrame()).toContain("5s"));

    stdin.write("\u001B[B"); // task-m
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("1m 5s");
    });
  });

  it("should handle task not found in detail mode", async () => {
    const { lastFrame, stdin } = render(
      <AppProvider>
        <ChatProvider>
          <BackgroundTaskManager onCancel={vi.fn()} />
        </ChatProvider>
      </AppProvider>,
    );

    await vi.waitFor(() => {
      expect(Agent.create).toHaveBeenCalled();
    });

    const agentCreateArgs = vi.mocked(Agent.create).mock.calls[0][0];
    const callbacks = agentCreateArgs.callbacks!;
    callbacks.onBackgroundTasksChange!(
      mockTasks as unknown as BackgroundTask[],
    );

    await vi.waitFor(() => expect(lastFrame()).toContain("[task-1]"));

    stdin.write("\r");
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("Background Task Details");
    });

    callbacks.onBackgroundTasksChange!([]);

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
          <BackgroundTaskManager onCancel={vi.fn()} />
        </ChatProvider>
      </AppProvider>,
    );

    await vi.waitFor(() => {
      expect(Agent.create).toHaveBeenCalled();
    });

    const agentCreateArgs = vi.mocked(Agent.create).mock.calls[0][0];
    const callbacks = agentCreateArgs.callbacks!;
    callbacks.onBackgroundTasksChange!(
      taskNoDesc as unknown as BackgroundTask[],
    );

    await vi.waitFor(() => {
      expect(lastFrame()).toContain("[task-no-desc] shell");
    });
  });

  it("should stop task from detail mode", async () => {
    const { lastFrame, stdin } = render(
      <AppProvider>
        <ChatProvider>
          <BackgroundTaskManager onCancel={vi.fn()} />
        </ChatProvider>
      </AppProvider>,
    );

    await vi.waitFor(() => {
      expect(Agent.create).toHaveBeenCalled();
    });

    const agentCreateArgs = vi.mocked(Agent.create).mock.calls[0][0];
    const callbacks = agentCreateArgs.callbacks!;
    callbacks.onBackgroundTasksChange!(
      mockTasks as unknown as BackgroundTask[],
    );

    await vi.waitFor(() => expect(lastFrame()).toContain("[task-1]"));

    stdin.write("\r");
    await vi.waitFor(() =>
      expect(lastFrame()).toContain("Background Task Details"),
    );

    stdin.write("k");

    await vi.waitFor(() => {
      expect(mockAgent.stopBackgroundTask).toHaveBeenCalledWith("task-1");
    });
  });

  it("should navigate with up/down arrows", async () => {
    const { lastFrame, stdin } = render(
      <AppProvider>
        <ChatProvider>
          <BackgroundTaskManager onCancel={vi.fn()} />
        </ChatProvider>
      </AppProvider>,
    );

    await vi.waitFor(() => {
      expect(Agent.create).toHaveBeenCalled();
    });

    const agentCreateArgs = vi.mocked(Agent.create).mock.calls[0][0];
    const callbacks = agentCreateArgs.callbacks!;
    callbacks.onBackgroundTasksChange!(
      mockTasks as unknown as BackgroundTask[],
    );

    await vi.waitFor(() => expect(lastFrame()).toContain("[task-1]"));

    stdin.write("\u001B[B");
    await vi.waitFor(() => expect(lastFrame()).toContain("▶ 2."));

    stdin.write("\u001B[A");
    await vi.waitFor(() => {
      expect(lastFrame()).toContain("▶ 1.");
    });
  });

  // A workflow background task's id IS its run id, so `/tasks` can show the run's
  // progress instead of the (always empty) text output. The fields come from the
  // same run data `/workflows` renders (spec multi-agent/workflow「在后台任务面板里
  // 看到工作流进度」).
  describe("workflow task progress", () => {
    const workflowTask = {
      id: "wf_123",
      type: "workflow" as const,
      description: "Workflow: audit-and-fix",
      status: "running" as const,
      startTime: Date.now() - 3000,
      stdout: "",
      stderr: "",
    };
    const workflowRun: WorkflowRun = {
      runId: "wf_123",
      meta: { name: "audit-and-fix", description: "Audit then fix" },
      status: "running",
      scriptPath: "/tmp/workflows/run/script.ts",
      startTime: Date.now() - 3000,
      phases: [
        {
          title: "Scan",
          agentCount: 2,
          tokens: 1200,
          elapsed: 1500,
          startTime: Date.now() - 2800,
        },
        {
          title: "Fix",
          agentCount: 1,
          tokens: 800,
          elapsed: 900,
          startTime: Date.now() - 1000,
        },
      ],
      totalAgents: 3,
      totalTokens: 2000,
      logs: ["scanning files", "found 3 issues"],
    };

    const setup = async (runs: WorkflowRun[]) => {
      vi.mocked(Agent.create).mockResolvedValue({
        ...mockAgent,
        getWorkflowRuns: vi.fn(async () => runs),
        // A workflow task carries no text output, exactly like the real one.
        getBackgroundTaskOutput: vi.fn(() => ({
          stdout: "",
          stderr: "",
          status: "running",
        })),
      } as unknown as Agent);

      const result = render(
        <AppProvider>
          <ChatProvider>
            <BackgroundTaskManager onCancel={vi.fn()} />
          </ChatProvider>
        </AppProvider>,
      );

      await vi.waitFor(() => {
        expect(Agent.create).toHaveBeenCalled();
      });

      const callbacks = vi.mocked(Agent.create).mock.calls[0][0].callbacks!;
      callbacks.onBackgroundTasksChange!([
        workflowTask,
      ] as unknown as BackgroundTask[]);

      await vi.waitFor(() => expect(result.lastFrame()).toContain("wf_123"));
      return result;
    };

    it("should render the run's progress on Enter instead of an empty output", async () => {
      const { lastFrame, stdin } = await setup([workflowRun]);

      stdin.write("\r");
      await vi.waitFor(() => {
        expect(lastFrame()).toContain("Background Task Details: wf_123");
      });

      const frame = lastFrame() ?? "";
      expect(frame).toContain("Phases:");
      expect(frame).toContain("Scan — 2 agents | 1.2k tokens | 2s");
      expect(frame).toContain("Fix — 1 agents | 800 tokens | 900ms");
      expect(frame).toContain("Agents: 3");
      expect(frame).toContain("Tokens: 2.0k");
      expect(frame).toContain("Script: /tmp/workflows/run/script.ts");
      expect(frame).toContain("Logs (last 10 lines):");
      expect(frame).toContain("scanning files");
      // The workflow task has no text output at all — that is the whole point.
      expect(frame).not.toContain("OUTPUT (last 10 lines):");
      // The run block owns status/时间, so the task header does not repeat it.
      expect(frame).not.toContain("Runtime:");
    });

    it("should keep showing progress with the final state and error once the run ended", async () => {
      const failedRun: WorkflowRun = {
        ...workflowRun,
        status: "failed",
        endTime: workflowRun.startTime + 5000,
        error: "2 of 3 agents failed",
        failures: ["Scan: boom"],
      };
      const { lastFrame, stdin } = await setup([failedRun]);

      stdin.write("\r");
      await vi.waitFor(() => {
        expect(lastFrame()).toContain("Background Task Details: wf_123");
      });

      const frame = lastFrame() ?? "";
      expect(frame).toContain("Status: failed");
      expect(frame).toContain("Error: 2 of 3 agents failed");
      expect(frame).toContain("Failures:");
      expect(frame).toContain("Scan: boom");
      expect(frame).toContain("Phases:");
    });

    it("should fall back to the task header when the run is no longer listed", async () => {
      const { lastFrame, stdin } = await setup([]);

      stdin.write("\r");
      await vi.waitFor(() => {
        expect(lastFrame()).toContain("Background Task Details: wf_123");
      });

      const frame = lastFrame() ?? "";
      expect(frame).toContain("Status: running");
      expect(frame).toContain("Started:");
      expect(frame).not.toContain("Phases:");
      expect(frame).not.toContain("Run ID:");
    });

    it("should ignore runs whose id is not the selected task", async () => {
      const otherRun: WorkflowRun = { ...workflowRun, runId: "wf_other" };
      const { lastFrame, stdin } = await setup([otherRun]);

      stdin.write("\r");
      await vi.waitFor(() => {
        expect(lastFrame()).toContain("Background Task Details: wf_123");
      });

      const frame = lastFrame() ?? "";
      expect(frame).toContain("Status: running");
      expect(frame).not.toContain("Phases:");
    });
  });
});
