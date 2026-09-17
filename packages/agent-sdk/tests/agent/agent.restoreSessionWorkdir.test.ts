import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import { dirname, join } from "path";
import { Agent } from "../../src/agent.js";
import { MemoryRuleManager } from "../../src/managers/MemoryRuleManager.js";
import { MemoryService } from "../../src/services/memory.js";
import { pathEncoder } from "../../src/utils/pathEncoder.js";

vi.mock("@/services/aiService", () => ({
  createChatCompletion: vi.fn(),
}));

vi.mock("../../src/services/session.js", () => ({
  generateSessionId: vi.fn(() => randomUUID()),
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

vi.mock("../../src/services/taskManager.js", () => {
  const mockTaskManager = {
    on: vi.fn(),
    listTasks: vi.fn().mockResolvedValue([]),
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

describe("Agent.restoreSession - target workdir", () => {
  const currentWorkdir = "/mock/current/workdir";
  const targetWorkdir = "/mock/other/worktree";

  const sessionData = (id: string, workdir: string) => ({
    id,
    messages: [],
    metadata: {
      workdir,
      lastActiveAt: new Date().toISOString(),
      latestTotalTokens: 0,
    },
  });

  const createAgent = async (callbacks = {}) => {
    const { handleSessionRestoration } = await import(
      "../../src/services/session.js"
    );
    vi.mocked(handleSessionRestoration).mockResolvedValue(
      sessionData(randomUUID(), currentWorkdir),
    );
    return Agent.create({
      apiKey: "test-key",
      baseURL: "https://test.com",
      workdir: currentWorkdir,
      callbacks,
    });
  };

  const mockTarget = async (id: string, workdir: string) => {
    const { loadSessionFromJsonl } = await import(
      "../../src/services/session.js"
    );
    vi.mocked(loadSessionFromJsonl).mockResolvedValue(sessionData(id, workdir));
    return vi.mocked(loadSessionFromJsonl);
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads the target session from its own directory and moves this session there", async () => {
    const agent = await createAgent();
    const targetSessionId = randomUUID();
    const load = await mockTarget(targetSessionId, targetWorkdir);

    await agent.restoreSession(targetSessionId, { workdir: targetWorkdir });

    expect(load).toHaveBeenCalledWith(targetSessionId, targetWorkdir);
    expect(agent.workingDirectory).toBe(targetWorkdir);
    expect(agent.sessionId).toBe(targetSessionId);
    expect(dirname(agent.sessionFilePath)).toBe(
      join("/mock/session/dir", pathEncoder.encodeSync(targetWorkdir)),
    );

    await agent.destroy();
  });

  it("leaves the session untouched when the target transcript cannot be loaded", async () => {
    const onWorkdirChange = vi.fn();
    const agent = await createAgent({ onWorkdirChange });
    const currentSessionId = agent.sessionId;
    const { loadSessionFromJsonl } = await import(
      "../../src/services/session.js"
    );
    vi.mocked(loadSessionFromJsonl).mockResolvedValue(null);

    onWorkdirChange.mockClear();

    await expect(
      agent.restoreSession(randomUUID(), { workdir: targetWorkdir }),
    ).rejects.toThrow();

    expect(agent.workingDirectory).toBe(currentWorkdir);
    expect(agent.sessionId).toBe(currentSessionId);
    expect(onWorkdirChange).not.toHaveBeenCalled();

    await agent.destroy();
  });

  it("keeps the current directory when no target workdir is given", async () => {
    const agent = await createAgent();
    const targetSessionId = randomUUID();
    const load = await mockTarget(targetSessionId, currentWorkdir);

    await agent.restoreSession(targetSessionId);

    expect(load).toHaveBeenCalledWith(targetSessionId, currentWorkdir);
    expect(agent.workingDirectory).toBe(currentWorkdir);

    await agent.destroy();
  });

  it("invalidates directory-derived caches when the workdir changes", async () => {
    const agent = await createAgent();
    const clearCache = vi.spyOn(MemoryService.prototype, "clearCache");
    const discoverRules = vi.spyOn(
      MemoryRuleManager.prototype,
      "discoverRules",
    );
    const targetSessionId = randomUUID();
    await mockTarget(targetSessionId, targetWorkdir);

    clearCache.mockClear();
    discoverRules.mockClear();

    await agent.restoreSession(targetSessionId, { workdir: targetWorkdir });

    expect(clearCache).toHaveBeenCalled();
    expect(discoverRules).toHaveBeenCalled();

    clearCache.mockRestore();
    discoverRules.mockRestore();
    await agent.destroy();
  });
});
