import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "crypto";
import { Agent } from "../../src/agent.js";
import type { AgentCallbacks } from "../../src/types/agent.js";

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
  reAppendSessionMetadata: vi.fn().mockResolvedValue(undefined),
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

/**
 * `workspaceRoot` is the third directory value (see `.wave/rules/workdir.md`):
 * the working tree the session works in right now. It differs from the two
 * existing ones precisely on the two moves that used to be conflated —
 * a Bash `cd` (which must NOT move it) and EnterWorktree / ExitWorktree
 * (which must).
 */
describe("Agent workspaceRoot", () => {
  const workdir = "/mock/current/workdir";

  const sessionData = (id: string, dir: string) => ({
    id,
    messages: [],
    metadata: {
      workdir: dir,
      lastActiveAt: new Date().toISOString(),
      latestTotalTokens: 0,
    },
  });

  const createAgent = async (callbacks: AgentCallbacks = {}) => {
    const { handleSessionRestoration } = await import(
      "../../src/services/session.js"
    );
    vi.mocked(handleSessionRestoration).mockResolvedValue(
      sessionData(randomUUID(), workdir),
    );
    return Agent.create({
      apiKey: "test-key",
      baseURL: "https://test.com",
      workdir,
      callbacks,
    });
  };

  /** AIManager is the only writer of the workspace root (the worktree tools). */
  const aiManagerOf = (agent: Agent) =>
    (agent as unknown as { aiManager: { setWorkspaceRoot(v: string): void } })
      .aiManager;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts at the session's opening directory", async () => {
    const agent = await createAgent();

    expect(agent.workspaceRoot).toBe(workdir);
    expect(agent.sessionWorkdir).toBe(workdir);

    await agent.destroy();
  });

  it("does not move when the shell `cd`s", async () => {
    const agent = await createAgent();

    // What AIManager's cwd-change callback does for a `cd` in Bash (and what
    // the cwd-recovery path does): the shell moves, the session does not.
    agent.setCurrentWorkdir("/mock/current/workdir/packages/webview");

    expect(agent.currentWorkdir).toBe("/mock/current/workdir/packages/webview");
    expect(agent.workspaceRoot).toBe(workdir);
    expect(agent.sessionWorkdir).toBe(workdir);

    await agent.destroy();
  });

  it("moves with the session when it relocates into a worktree, and notifies the host", async () => {
    const onWorkspaceRootChange = vi.fn();
    const agent = await createAgent({ onWorkspaceRootChange });
    const worktreePath = "/mock/current/workdir/.wave/worktrees/feature";

    // What EnterWorktree does: shell and workspace both move.
    agent.setCurrentWorkdir(worktreePath);
    aiManagerOf(agent).setWorkspaceRoot(worktreePath);

    expect(agent.currentWorkdir).toBe(worktreePath);
    expect(agent.workspaceRoot).toBe(worktreePath);
    // Identity stays put: the conversation still belongs to the repo it started
    // in (worktrees are the same repository).
    expect(agent.sessionWorkdir).toBe(workdir);
    expect(onWorkspaceRootChange).toHaveBeenCalledWith(worktreePath);

    await agent.destroy();
  });

  it("follows a restored session even when this agent was in a worktree", async () => {
    const agent = await createAgent();
    aiManagerOf(agent).setWorkspaceRoot(
      "/mock/current/workdir/.wave/worktrees/feature",
    );

    const targetWorkdir = "/mock/other/repo";
    const targetSessionId = randomUUID();
    const { loadSessionFromJsonl } = await import(
      "../../src/services/session.js"
    );
    vi.mocked(loadSessionFromJsonl).mockResolvedValue(
      sessionData(targetSessionId, targetWorkdir),
    );

    await agent.restoreSession(targetSessionId, { workdir: targetWorkdir });

    // The incoming session's workspace starts where that session lives; the
    // outgoing session's worktree must not leak into it.
    expect(agent.currentWorkdir).toBe(targetWorkdir);
    expect(agent.workspaceRoot).toBe(targetWorkdir);
    expect(agent.sessionWorkdir).toBe(targetWorkdir);

    await agent.destroy();
  });
});
