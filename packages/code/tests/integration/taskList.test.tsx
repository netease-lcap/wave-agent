import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "ink-testing-library";
import { ChatInterface } from "../../src/components/ChatInterface.js";
import { ChatProvider } from "../../src/contexts/useChat.js";
import { AppProvider } from "../../src/contexts/useAppConfig.js";
import { Agent, stripAnsiColors, type Task } from "wave-agent-sdk";

// Mock Agent.create to control the agent instance
vi.mock("wave-agent-sdk", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    Agent: {
      ...(actual.Agent as Record<string, unknown>),
      create: vi.fn(),
    },
  };
});

describe("TaskList Integration", () => {
  const mockTasks: Task[] = [
    {
      id: "task-1",
      subject: "First Task",
      status: "pending",
      description: "First Task Description",
      blocks: [],
      blockedBy: [],
      metadata: {},
    },
    {
      id: "task-2",
      subject: "Second Task",
      status: "in_progress",
      description: "Second Task Description",
      blocks: [],
      blockedBy: [],
      metadata: {},
    },
    {
      id: "task-3",
      subject: "Third Task",
      status: "completed",
      description: "Third Task Description",
      blocks: [],
      blockedBy: [],
      metadata: {},
    },
  ];

  let mockAgent: Awaited<ReturnType<typeof Agent.create>>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockAgent = {
      sessionId: "test-session",
      messages: [],
      isLoading: false,
      latestTotalTokens: 0,
      isCommandRunning: false,
      isCompressing: false,
      userInputHistory: [],
      getPermissionMode: vi.fn().mockReturnValue("default"),
      getMcpServers: vi.fn().mockReturnValue([]),
      getSlashCommands: vi.fn().mockReturnValue([]),
      getGatewayConfig: vi.fn().mockReturnValue({ baseURL: "" }),
      getModelConfig: vi.fn().mockReturnValue({
        model: "test-model",
        fastModel: "test-fast-model",
      }),
      destroy: vi.fn(),
    } as unknown as Agent;

    vi.mocked(Agent.create).mockResolvedValue(mockAgent);
  });

  it("renders tasks from the agent in ChatInterface", async () => {
    let onTasksChangeCallback: (tasks: Task[]) => void = () => {};

    vi.mocked(Agent.create).mockImplementation(async (options) => {
      onTasksChangeCallback = options.callbacks!.onTasksChange!;
      return mockAgent;
    });

    const { lastFrame } = render(
      <AppProvider>
        <ChatProvider>
          <ChatInterface />
        </ChatProvider>
      </AppProvider>,
    );

    // Wait for Agent to initialize
    await vi.waitFor(() => {
      expect(Agent.create).toHaveBeenCalled();
    });

    // Initially no tasks should be visible
    expect(stripAnsiColors(lastFrame() || "")).not.toContain("TASKS");

    // Simulate tasks being added/changed in the agent
    onTasksChangeCallback(mockTasks);

    // Verify tasks are rendered
    await vi.waitFor(() => {
      const output = stripAnsiColors(lastFrame() || "");
      expect(output).toContain("□ First Task");
      expect(output).toContain("■ Second Task");
      expect(output).toContain("✓ Third Task");
    });
  });

  it("updates task list when tasks change", async () => {
    let onTasksChangeCallback: (tasks: Task[]) => void = () => {};

    vi.mocked(Agent.create).mockImplementation(async (options) => {
      onTasksChangeCallback = options.callbacks!.onTasksChange!;
      return mockAgent;
    });

    const { lastFrame } = render(
      <AppProvider>
        <ChatProvider>
          <ChatInterface />
        </ChatProvider>
      </AppProvider>,
    );

    await vi.waitFor(() => {
      expect(Agent.create).toHaveBeenCalled();
    });

    // Add initial task
    onTasksChangeCallback([mockTasks[0]]);
    await vi.waitFor(() => {
      expect(stripAnsiColors(lastFrame() || "")).toContain("First Task");
    });

    // Update task status
    onTasksChangeCallback([{ ...mockTasks[0], status: "completed" }]);
    await vi.waitFor(() => {
      expect(stripAnsiColors(lastFrame() || "")).toContain("✓ First Task");
    });

    // Remove all tasks
    onTasksChangeCallback([]);
    await vi.waitFor(() => {
      expect(stripAnsiColors(lastFrame() || "")).not.toContain("First Task");
    });
  });
});
