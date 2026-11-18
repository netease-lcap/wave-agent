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
      expect.anything(),
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

  /**
   * `initialUserMessage` 只在 `startup` / `clear` 注入：Claude Code 把它定为
   * 非交互 `-p` 模式专用（"becomes the first turn even if you pass no prompt"），
   * 而恢复出来的对话已经有自己的第一轮。`additionalContext` 不受影响。
   */
  it("should NOT inject initialUserMessage on restore", async () => {
    const { handleSessionRestoration, loadSessionFromJsonl } = await import(
      "../../src/services/session.js"
    );
    vi.mocked(handleSessionRestoration).mockResolvedValue({
      id: randomUUID(),
      messages: [],
      metadata: {
        workdir: testWorkdir,
        lastActiveAt: new Date().toISOString(),
        latestTotalTokens: 0,
      },
    });
    vi.mocked(loadSessionFromJsonl).mockResolvedValue({
      id: randomUUID(),
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
    const hookManager = (agent as unknown as { hookManager: HookManager })
      .hookManager;
    vi.spyOn(hookManager, "executeSessionStartHooks").mockResolvedValue({
      results: [],
      additionalContext: "Restored session context",
      initialUserMessage: "Start with a plan",
    });

    await agent.restoreSession(randomUUID());

    const messageManager = (
      agent as unknown as { messageManager: MessageManager }
    ).messageManager;
    const messages = messageManager.getMessages();
    const texts = messages.flatMap((message) =>
      message.blocks.flatMap((block) =>
        block.type === "text" ? [block.content] : [],
      ),
    );
    // The `-p` field must not become a turn of a resumed conversation…
    expect(texts).not.toContain("Start with a plan");
    // …while `additionalContext` still lands, as a meta user message.
    const injected = messages[messages.length - 1];
    expect(injected.isMeta).toBe(true);
    expect(texts[texts.length - 1]).toContain("Restored session context");

    await agent.destroy();
  });

  it("should never inject initialUserMessage across repeated restores (A→B→A)", async () => {
    const { handleSessionRestoration, loadSessionFromJsonl } = await import(
      "../../src/services/session.js"
    );
    const sessionA = randomUUID();
    const sessionB = randomUUID();
    vi.mocked(handleSessionRestoration).mockResolvedValue({
      id: sessionA,
      messages: [],
      metadata: {
        workdir: testWorkdir,
        lastActiveAt: new Date().toISOString(),
        latestTotalTokens: 0,
      },
    });
    // Neither transcript carries the text: nothing can mask a stray injection
    // behind `addMetaMessageIfAbsent`.
    const sessionData = (id: string) => ({
      id,
      messages: [],
      metadata: {
        workdir: testWorkdir,
        lastActiveAt: new Date().toISOString(),
        latestTotalTokens: 0,
      },
    });
    vi.mocked(loadSessionFromJsonl).mockImplementation(async (id: string) =>
      sessionData(id),
    );

    const agent = await Agent.create({
      apiKey: "test-key",
      baseURL: "https://test.com",
      workdir: testWorkdir,
    });
    const hookManager = (agent as unknown as { hookManager: HookManager })
      .hookManager;
    vi.spyOn(hookManager, "executeSessionStartHooks").mockResolvedValue({
      results: [],
      initialUserMessage: "Start with a plan",
    });

    const messageManager = (
      agent as unknown as { messageManager: MessageManager }
    ).messageManager;
    const occurrences = () =>
      messageManager
        .getMessages()
        .filter((message) =>
          message.blocks.some(
            (block) =>
              block.type === "text" && block.content === "Start with a plan",
          ),
        );

    await agent.restoreSession(sessionB);
    expect(occurrences()).toHaveLength(0);
    await agent.restoreSession(sessionA);
    expect(occurrences()).toHaveLength(0);

    await agent.destroy();
  });

  /**
   * 平台层去重（对齐 Claude Code 2.1.295）：`resume` 是往**已有**对话尾部追加，
   * 上一次运行注入的那份副本还在列表里，所以同内容不再加第二份；内容变了就刷新。
   */
  describe("SessionStart resume injection dedupe", () => {
    const startCopy = (context: string) =>
      `<system-reminder>\nSessionStart hook additional context: ${context}\n</system-reminder>`;

    const metaTextsOf = (messageManager: MessageManager) =>
      messageManager
        .getMessages()
        .filter((message) => message.isMeta)
        .flatMap((message) =>
          message.blocks.flatMap((block) =>
            block.type === "text" ? [block.content] : [],
          ),
        );

    async function restoreWith(history: unknown[], context: string) {
      const initialSessionId = randomUUID();
      const targetSessionId = randomUUID();
      const { handleSessionRestoration, loadSessionFromJsonl } = await import(
        "../../src/services/session.js"
      );
      vi.mocked(handleSessionRestoration).mockResolvedValue({
        id: initialSessionId,
        messages: [],
        metadata: {
          workdir: testWorkdir,
          lastActiveAt: new Date().toISOString(),
          latestTotalTokens: 0,
        },
      });
      vi.mocked(loadSessionFromJsonl).mockResolvedValue({
        id: targetSessionId,
        messages: history,
        metadata: {
          workdir: testWorkdir,
          lastActiveAt: new Date().toISOString(),
          latestTotalTokens: 0,
        },
      } as unknown as Awaited<ReturnType<typeof loadSessionFromJsonl>>);

      const agent = await Agent.create({
        apiKey: "test-key",
        baseURL: "https://test.com",
        workdir: testWorkdir,
      });
      vi.spyOn(
        (agent as unknown as { hookManager: HookManager }).hookManager,
        "executeSessionEndHooks",
      ).mockResolvedValue([]);
      vi.spyOn(
        (agent as unknown as { hookManager: HookManager }).hookManager,
        "executeSessionStartHooks",
      ).mockResolvedValue({ results: [], additionalContext: context });

      await agent.restoreSession(targetSessionId);
      const messageManager = (
        agent as unknown as { messageManager: MessageManager }
      ).messageManager;
      const texts = metaTextsOf(messageManager);
      const total = messageManager.getMessages().length;
      await agent.destroy();
      return { texts, total };
    }

    const previousRunCopy = () => ({
      id: "msg-previous-run",
      role: "user" as const,
      blocks: [{ type: "text" as const, content: startCopy("Cached context") }],
      timestamp: new Date().toISOString(),
      isMeta: true,
    });

    it("keeps the copy the previous run injected instead of appending a second one", async () => {
      const { texts, total } = await restoreWith(
        [previousRunCopy()],
        "Cached context",
      );

      expect(texts).toEqual([startCopy("Cached context")]);
      expect(total).toBe(1);
    });

    it("appends when the hook's context changed, so the stale copy is refreshed", async () => {
      const { texts, total } = await restoreWith(
        [previousRunCopy()],
        "Fresh context",
      );

      expect(texts).toEqual([
        startCopy("Cached context"),
        startCopy("Fresh context"),
      ]);
      expect(total).toBe(2);
    });
  });
});
