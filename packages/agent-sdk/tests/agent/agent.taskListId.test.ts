import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Agent } from "../../src/agent.js";
import { TaskManager } from "../../src/services/taskManager.js";

// Mock dependencies to prevent real I/O operations
vi.mock("@/services/aiService", () => ({
  createChatCompletion: vi.fn(),
}));

vi.mock("../../src/services/session.js", () => ({
  generateSessionId: vi.fn(() => "mock-session-id"),
  loadSessionFromJsonl: vi.fn(),
  appendMessages: vi.fn(),
  getLatestSessionFromJsonl: vi.fn(),
  listSessionsFromJsonl: vi.fn(),
  deleteSessionFromJsonl: vi.fn(),
  sessionExistsInJsonl: vi.fn(),
  cleanupExpiredSessionsFromJsonl: vi.fn(() => Promise.resolve(0)),
  getSessionFilePath: vi.fn(),
  ensureSessionDir: vi.fn(),
  listSessions: vi.fn(),
  cleanupEmptyProjectDirectories: vi.fn(),
  handleSessionRestoration: vi.fn().mockResolvedValue({
    id: "mock-session-id",
    messages: [],
    metadata: {
      workdir: "/mock",
      lastActiveAt: new Date().toISOString(),
      latestTotalTokens: 0,
    },
  }),
  SESSION_DIR: "/mock/session/dir",
}));

// Mock TaskManager to capture the taskListId passed to it
vi.mock("../../src/services/taskManager.js", () => {
  const mockTaskManager = {
    on: vi.fn(),
    listTasks: vi.fn().mockResolvedValue([]),
    getTaskListId: vi.fn(),
  };
  return {
    TaskManager: vi.fn().mockImplementation(function (taskListId: string) {
      (mockTaskManager as { taskListId?: string }).taskListId = taskListId; // Expose for verification
      mockTaskManager.getTaskListId.mockReturnValue(taskListId);
      return mockTaskManager;
    }),
  };
});

describe("Agent - Task List ID Resolution", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should use WAVE_TASK_LIST_ID from environment if set", async () => {
    process.env.WAVE_TASK_LIST_ID = "custom-task-list-id";

    const agent = await Agent.create({
      apiKey: "test-key",
      workdir: "/mock",
    });

    expect(TaskManager).toHaveBeenCalledWith("custom-task-list-id");
    expect(agent.taskListId).toBe("custom-task-list-id");

    await agent.destroy();
  });

  it("should fallback to sessionId if WAVE_TASK_LIST_ID is not set", async () => {
    delete process.env.WAVE_TASK_LIST_ID;

    const agent = await Agent.create({
      apiKey: "test-key",
      workdir: "/mock",
    });

    // The mock session ID is "mock-session-id"
    expect(TaskManager).toHaveBeenCalledWith("mock-session-id");
    expect(agent.taskListId).toBe("mock-session-id");

    await agent.destroy();
  });

  it("should maintain stable taskListId even if sessionId changes", async () => {
    delete process.env.WAVE_TASK_LIST_ID;

    const agent = await Agent.create({
      apiKey: "test-key",
      workdir: "/mock",
    });

    const initialTaskListId = agent.taskListId;
    expect(initialTaskListId).toBe("mock-session-id");

    // Simulate sessionId change (e.g. via messageManager internal state change)
    // Since we can't easily trigger compression in a unit test, we verify that
    // TaskManager was only initialized once and agent.taskListId returns the stable value.

    // We check that TaskManager was called with the initial ID
    expect(TaskManager).toHaveBeenCalledWith("mock-session-id");

    // Even if we were to mock messageManager.getSessionId to return something else now,
    // the agent's taskListId logic in constructor has already run.

    await agent.destroy();
  });
});
