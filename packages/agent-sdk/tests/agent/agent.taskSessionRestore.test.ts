import { describe, it, expect, vi, beforeEach } from "vitest";
import { Agent } from "../../src/agent.js";
import { randomUUID } from "crypto";

// Mock dependencies to prevent real I/O operations
vi.mock("@/services/aiService", () => ({
  createChatCompletion: vi.fn(),
}));

// Mock session service functions
vi.mock("../../src/services/session.js", () => ({
  generateSessionId: vi.fn(),
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
  handleSessionRestoration: vi.fn(),
  SESSION_DIR: "/mock/session/dir",
}));

// Mock TaskManager to avoid real file system access
vi.mock("../../src/services/taskManager.js", () => {
  const mockTaskManager = {
    on: vi.fn(),
    listTasks: vi.fn().mockResolvedValue([
      {
        id: "task-1",
        subject: "Restored Task",
        status: "pending",
        description: "Task from restored session",
        blocks: [],
        blockedBy: [],
        metadata: {},
      },
    ]),
    setTaskListId: vi.fn(),
  };
  return {
    TaskManager: vi.fn(function () {
      return mockTaskManager;
    }),
  };
});

describe("Agent - Task Session Restoration", () => {
  let testWorkdir: string;

  beforeEach(() => {
    testWorkdir = "/mock/test/workdir";
    vi.clearAllMocks();
  });

  it("should fetch and emit tasks when a session is restored during initialization", async () => {
    const sessionId = randomUUID();
    const { handleSessionRestoration } = await import(
      "../../src/services/session.js"
    );
    const mockHandleSessionRestoration = vi.mocked(handleSessionRestoration);

    const sessionData = {
      id: sessionId,
      messages: [],
      metadata: {
        workdir: testWorkdir,
        lastActiveAt: new Date().toISOString(),
        latestTotalTokens: 0,
      },
    };

    mockHandleSessionRestoration.mockResolvedValue(sessionData);

    const onSessionTasksChange = vi.fn();

    const agent = await Agent.create({
      apiKey: "test-key",
      baseURL: "https://test.com",
      restoreSessionId: sessionId,
      workdir: testWorkdir,
      callbacks: {
        onSessionTasksChange,
      },
    });

    // Verify tasks were fetched and callback was called
    expect(onSessionTasksChange).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          id: "task-1",
          subject: "Restored Task",
        }),
      ]),
    );

    await agent.destroy();
  });

  it("should fetch and emit tasks when a session is restored via restoreSession method", async () => {
    const initialSessionId = randomUUID();
    const targetSessionId = randomUUID();
    const { handleSessionRestoration, loadSessionFromJsonl } = await import(
      "../../src/services/session.js"
    );
    const mockHandleSessionRestoration = vi.mocked(handleSessionRestoration);
    const mockLoadSessionFromJsonl = vi.mocked(loadSessionFromJsonl);

    mockHandleSessionRestoration.mockResolvedValue({
      id: initialSessionId,
      messages: [],
      metadata: {
        workdir: testWorkdir,
        lastActiveAt: new Date().toISOString(),
        latestTotalTokens: 0,
      },
    });

    mockLoadSessionFromJsonl.mockResolvedValue({
      id: targetSessionId,
      messages: [],
      metadata: {
        workdir: testWorkdir,
        lastActiveAt: new Date().toISOString(),
        latestTotalTokens: 0,
      },
    });

    const onSessionTasksChange = vi.fn();

    const agent = await Agent.create({
      apiKey: "test-key",
      baseURL: "https://test.com",
      workdir: testWorkdir,
      callbacks: {
        onSessionTasksChange,
      },
    });

    // Clear initial call from Agent.create
    onSessionTasksChange.mockClear();

    await agent.restoreSession(targetSessionId);

    // Verify tasks were fetched and callback was called for the target session
    expect(onSessionTasksChange).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          id: "task-1",
          subject: "Restored Task",
        }),
      ]),
    );

    await agent.destroy();
  });
});
