import { describe, it, expect, vi, beforeEach } from "vitest";
import { Agent } from "../../src/agent.js";
import { randomUUID } from "crypto";
import type { HookManager } from "../../src/managers/hookManager.js";
import type { MessageManager } from "../../src/managers/messageManager.js";

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
  cleanupMetaOnlySessions: vi.fn(() => Promise.resolve(0)),
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
    getTaskListId: vi.fn().mockReturnValue("initial-task-list-id"),
    refreshTasks: vi.fn().mockResolvedValue(undefined),
    syncWithSession: vi.fn().mockResolvedValue(undefined),
    cleanupOldTaskLists: vi.fn().mockResolvedValue(undefined),
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

    const onTasksChange = vi.fn();

    const agent = await Agent.create({
      apiKey: "test-key",
      baseURL: "https://test.com",
      restoreSessionId: sessionId,
      workdir: testWorkdir,
      callbacks: {
        onTasksChange,
      },
    });

    // Verify tasks were fetched and callback was called
    expect(onTasksChange).toHaveBeenCalledWith(
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

    const onTasksChange = vi.fn();

    const agent = await Agent.create({
      apiKey: "test-key",
      baseURL: "https://test.com",
      workdir: testWorkdir,
      callbacks: {
        onTasksChange,
      },
    });

    // Clear initial call from Agent.create
    onTasksChange.mockClear();

    await agent.restoreSession(targetSessionId);

    // Verify tasks were fetched and callback was called for the target session
    expect(onTasksChange).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          id: "task-1",
          subject: "Restored Task",
        }),
      ]),
    );

    await agent.destroy();
  });

  it("should fire SessionEnd then SessionStart resume hooks and inject additionalContext on restore", async () => {
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

    const agent = await Agent.create({
      apiKey: "test-key",
      baseURL: "https://test.com",
      workdir: testWorkdir,
    });

    const hookManager = (
      agent as unknown as {
        hookManager: HookManager;
      }
    ).hookManager;
    const sessionEndSpy = vi
      .spyOn(hookManager, "executeSessionEndHooks")
      .mockResolvedValue([]);
    const sessionStartSpy = vi
      .spyOn(hookManager, "executeSessionStartHooks")
      .mockResolvedValue({
        results: [],
        additionalContext: "Restored session context",
      });

    await agent.restoreSession(targetSessionId);

    // SessionEnd fires for the CURRENT session before switching
    expect(sessionEndSpy).toHaveBeenCalledTimes(1);
    expect(sessionEndSpy).toHaveBeenCalledWith(
      "resume",
      initialSessionId,
      expect.any(String),
    );

    // SessionStart fires for the TARGET session after initialization
    expect(sessionStartSpy).toHaveBeenCalledTimes(1);
    expect(sessionStartSpy).toHaveBeenCalledWith(
      "resume",
      targetSessionId,
      expect.any(String),
    );

    // additionalContext is injected as a meta user message into the restored conversation
    const messageManager = (
      agent as unknown as { messageManager: MessageManager }
    ).messageManager;
    const messages = messageManager.getMessages();
    const injected = messages[messages.length - 1];
    expect(injected.role).toBe("user");
    expect(injected.isMeta).toBe(true);
    expect(
      (injected.blocks[0] as { type: "text"; content: string }).content,
    ).toContain("Restored session context");

    await agent.destroy();
  });
});
