import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs";
import { exitWorktreeTool } from "@/tools/exitWorktreeTool.js";
import type { ToolContext } from "@/tools/types.js";
import type { WorktreeSession } from "@/utils/worktreeSession.js";
import { TaskManager } from "@/services/taskManager.js";
import { Container } from "@/utils/container.js";
import * as worktreeUtils from "@/utils/worktreeUtils.js";
import * as worktreeHooks from "@/services/worktreeHooks.js";

vi.mock("@/utils/worktreeUtils.js");
// `removeWorktree` is automocked into a no-op here, so "did the directory go
// away" is answered by `existsSync` — the one witness the tool has in
// production too (the removal refuses silently instead of throwing). Only that
// call is intercepted; everything else stays the real fs.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, existsSync: vi.fn() };
});
vi.mock("@/services/worktreeHooks.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/services/worktreeHooks.js")>();
  return {
    ...actual,
    executeWorktreeRemoveHook: vi.fn(),
  };
});

describe("exitWorktreeTool", () => {
  let mockContext: ToolContext;
  let mockSetWorkdir: ReturnType<typeof vi.fn>;
  let mockSetWorkspaceRoot: ReturnType<typeof vi.fn>;
  let mockGetWorktreeSession: ReturnType<typeof vi.fn>;
  let mockSetWorktreeSession: ReturnType<typeof vi.fn>;
  const mockSession: WorktreeSession = {
    originalCwd: "/original/dir",
    worktreePath: "/repo/.wave/worktrees/test",
    worktreeBranch: "worktree-test",
    worktreeName: "test",
    isNew: true,
    repoRoot: "/repo",
    originalHeadCommit: "abc123",
  };

  beforeEach(() => {
    vi.resetAllMocks();

    mockSetWorkdir = vi.fn();
    mockSetWorkspaceRoot = vi.fn();
    mockGetWorktreeSession = vi.fn().mockReturnValue(null);
    mockSetWorktreeSession = vi.fn();

    mockContext = {
      workdir: "/repo/.wave/worktrees/test",
      taskManager: new TaskManager(new Container(), "test-session"),
      aiManager: {
        setCurrentWorkdir: mockSetWorkdir,
        setWorkspaceRoot: mockSetWorkspaceRoot,
        getCurrentWorkdir: () => "/repo/.wave/worktrees/test",
        getOriginalWorkdir: () => "/repo",
        getWorktreeSession: mockGetWorktreeSession,
        setWorktreeSession: mockSetWorktreeSession,
      } as never,
    };

    // Default: no active session (override in specific tests)
    mockGetWorktreeSession.mockReturnValue(null);
  });

  it("should have correct tool configuration", () => {
    expect(exitWorktreeTool.name).toBe("ExitWorktree");
    expect(exitWorktreeTool.config.function.name).toBe("ExitWorktree");
    expect(exitWorktreeTool.config.function.description).toContain(
      "Exit a worktree session",
    );
    expect(exitWorktreeTool.config.type).toBe("function");
    expect(exitWorktreeTool.prompt?.()).toContain("EnterWorktree");
  });

  it("should return no-op when no active worktree session", async () => {
    mockGetWorktreeSession.mockReturnValue(null);

    const result = await exitWorktreeTool.execute(
      { action: "keep" },
      mockContext,
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("No active worktree session");
    expect(result.content).toContain("No-op");
  });

  it("should reject if action parameter is missing", async () => {
    mockGetWorktreeSession.mockReturnValue(mockSession);

    const result = await exitWorktreeTool.execute({}, mockContext);

    expect(result.success).toBe(false);
    expect(result.error).toContain("action");
  });

  describe("action: keep", () => {
    beforeEach(() => {
      mockGetWorktreeSession.mockReturnValue(mockSession);
    });

    it("should restore CWD and preserve worktree", async () => {
      const result = await exitWorktreeTool.execute(
        { action: "keep" },
        mockContext,
      );

      expect(result.success).toBe(true);
      expect(result.content).toContain("Exited worktree");
      expect(result.content).toContain("preserved");
      expect(mockSetWorkdir).toHaveBeenCalledWith("/original/dir");
      // Back to the original working tree: the workspace root follows too, or
      // the diff panel / file tree would keep pointing at the exited worktree.
      expect(mockSetWorkspaceRoot).toHaveBeenCalledWith("/original/dir");
      expect(mockSetWorktreeSession).toHaveBeenCalledWith(null);
      expect(worktreeUtils.removeWorktree).not.toHaveBeenCalled();
    });
  });

  describe("action: remove", () => {
    beforeEach(() => {
      mockGetWorktreeSession.mockReturnValue(mockSession);
    });

    it("should refuse removal without discard_changes when worktree is dirty", async () => {
      vi.mocked(worktreeUtils.countWorktreeChanges).mockReturnValue({
        changedFiles: 3,
        commits: 2,
      });

      const result = await exitWorktreeTool.execute(
        { action: "remove" },
        mockContext,
      );

      expect(result.success).toBe(false);
      // `error` is the one line a collapsed block shows, so it carries both what
      // is at stake and the way out.
      expect(result.error).toBe(
        "Worktree has 3 uncommitted files and 2 commits — retry with discard_changes: true",
      );
      expect(result.content).toContain("3 uncommitted files");
      expect(result.content).toContain("2 commits");
    });

    it("should refuse removal when git status fails (fail-closed)", async () => {
      vi.mocked(worktreeUtils.countWorktreeChanges).mockReturnValue(null);

      const result = await exitWorktreeTool.execute(
        { action: "remove" },
        mockContext,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe(
        "Could not verify worktree state — retry with discard_changes: true",
      );
    });

    it("should proceed with removal when discard_changes is true", async () => {
      vi.mocked(worktreeUtils.countWorktreeChanges).mockReturnValue({
        changedFiles: 5,
        commits: 3,
      });

      const result = await exitWorktreeTool.execute(
        { action: "remove", discard_changes: true },
        mockContext,
      );

      expect(result.success).toBe(true);
      expect(result.content).toContain("Exited and removed worktree");
      expect(result.content).toContain(
        "Discarded 3 commits and 5 uncommitted files",
      );
      expect(worktreeUtils.removeWorktree).toHaveBeenCalled();
      expect(mockSetWorkdir).toHaveBeenCalledWith("/original/dir");
      // Back to the original working tree: the workspace root follows too, or
      // the diff panel / file tree would keep pointing at the exited worktree.
      expect(mockSetWorkspaceRoot).toHaveBeenCalledWith("/original/dir");
      expect(mockSetWorktreeSession).toHaveBeenCalledWith(null);
    });

    it("should proceed with removal when worktree is clean", async () => {
      vi.mocked(worktreeUtils.countWorktreeChanges).mockReturnValue({
        changedFiles: 0,
        commits: 0,
      });

      const result = await exitWorktreeTool.execute(
        { action: "remove" },
        mockContext,
      );

      expect(result.success).toBe(true);
      expect(result.content).toContain("Exited and removed worktree");
      expect(result.content).not.toContain("Discarded");
      expect(worktreeUtils.removeWorktree).toHaveBeenCalled();
    });

    it("should report a surviving worktree instead of claiming it was removed", async () => {
      mockGetWorktreeSession.mockReturnValue(mockSession);
      vi.mocked(worktreeUtils.countWorktreeChanges).mockReturnValue({
        changedFiles: 0,
        commits: 0,
      });
      // `removeWorktree` returns nothing: a refusal (locked, an independent
      // repository, the main working tree) and a failed delete look identical
      // from here. The only witness is the directory.
      vi.mocked(fs.existsSync).mockImplementation(
        (p) => p === mockSession.worktreePath,
      );

      const result = await exitWorktreeTool.execute(
        { action: "remove" },
        mockContext,
      );

      expect(worktreeUtils.removeWorktree).toHaveBeenCalled();
      // The old text announced success over a directory that is still there.
      expect(result.content).not.toContain("Exited and removed worktree");
      expect(result.success).toBe(false);
      expect(result.content).toContain(
        `Exited worktree at ${mockSession.worktreePath}, but it was not removed.`,
      );
      expect(result.content).toContain(
        `Worktree directory survived at ${mockSession.worktreePath}`,
      );
      expect(result.content).toContain("Session is now back in /original/dir");
      expect(result.error).toContain("was not removed");
      // The session still exits: the tool did the half of the job it could.
      expect(mockSetWorktreeSession).toHaveBeenCalledWith(null);
      expect(mockSetWorkdir).toHaveBeenCalledWith("/original/dir");
    });

    describe("action: remove — hook-based worktree (WorktreeRemove replace semantics)", () => {
      const hookBasedSession: WorktreeSession = {
        ...mockSession,
        hookBased: true,
      };

      beforeEach(() => {
        mockGetWorktreeSession.mockReturnValue(hookBasedSession);
        vi.mocked(worktreeUtils.countWorktreeChanges).mockReturnValue({
          changedFiles: 0,
          commits: 0,
        });
      });

      function contextWithHookManager(): ToolContext {
        return {
          ...mockContext,
          hookManager: {
            getConfiguration: () => ({
              WorktreeRemove: [{ hooks: [{ command: "cleanup.sh" }] }],
            }),
          } as never,
          messageManager: {
            getTranscriptPath: () => "/test/transcript.jsonl",
          } as never,
          sessionId: "test-session-id",
        };
      }

      it("should delegate removal to the WorktreeRemove hook (no git removal)", async () => {
        vi.mocked(worktreeHooks.executeWorktreeRemoveHook).mockResolvedValue(
          true,
        );

        const result = await exitWorktreeTool.execute(
          { action: "remove" },
          contextWithHookManager(),
        );

        expect(result.success).toBe(true);
        expect(result.content).toContain("Exited and removed worktree");
        expect(result.content).toContain("WorktreeRemove hooks were executed");
        expect(worktreeHooks.executeWorktreeRemoveHook).toHaveBeenCalledWith(
          "/repo/.wave/worktrees/test",
          expect.objectContaining({
            WorktreeRemove: expect.any(Array),
          }),
          expect.objectContaining({
            projectDir: "/original/dir",
            sessionId: "test-session-id",
            transcriptPath: "/test/transcript.jsonl",
          }),
        );
        // Hook replaced git: wave never runs `git worktree remove`
        expect(worktreeUtils.removeWorktree).not.toHaveBeenCalled();
        expect(mockSetWorkdir).toHaveBeenCalledWith("/original/dir");
        expect(mockSetWorkspaceRoot).toHaveBeenCalledWith("/original/dir");
        expect(mockSetWorktreeSession).toHaveBeenCalledWith(null);
      });

      it("should leave the worktree in place with a warning when no WorktreeRemove hook is configured", async () => {
        vi.mocked(worktreeHooks.executeWorktreeRemoveHook).mockResolvedValue(
          false,
        );

        const result = await exitWorktreeTool.execute(
          { action: "remove" },
          {
            ...mockContext,
            hookManager: { getConfiguration: () => undefined } as never,
          },
        );

        expect(result.success).toBe(true);
        expect(result.content).toContain("Exited and removed worktree");
        expect(result.content).toContain(
          "No WorktreeRemove hook configured, hook-based worktree left at the path above",
        );
        // No git removal for hook-based worktrees, even without a Remove hook
        expect(worktreeUtils.removeWorktree).not.toHaveBeenCalled();
      });

      it("should still fail closed for hook-based worktrees with uncommitted changes", async () => {
        vi.mocked(worktreeUtils.countWorktreeChanges).mockReturnValue({
          changedFiles: 2,
          commits: 0,
        });

        const result = await exitWorktreeTool.execute(
          { action: "remove" },
          contextWithHookManager(),
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe(
          "Worktree has 2 uncommitted files — retry with discard_changes: true",
        );
        expect(worktreeHooks.executeWorktreeRemoveHook).not.toHaveBeenCalled();
      });

      it("should still refuse removal when worktree state cannot be verified (fail-closed)", async () => {
        vi.mocked(worktreeUtils.countWorktreeChanges).mockReturnValue(null);

        const result = await exitWorktreeTool.execute(
          { action: "remove" },
          contextWithHookManager(),
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe(
          "Could not verify worktree state — retry with discard_changes: true",
        );
        expect(worktreeHooks.executeWorktreeRemoveHook).not.toHaveBeenCalled();
      });
    });

    describe("action: remove — git-based worktree (no hook)", () => {
      beforeEach(() => {
        mockGetWorktreeSession.mockReturnValue(mockSession);
        vi.mocked(worktreeUtils.countWorktreeChanges).mockReturnValue({
          changedFiles: 0,
          commits: 0,
        });
      });

      it("should use git removal and never call the WorktreeRemove hook", async () => {
        const contextWithHookManager: ToolContext = {
          ...mockContext,
          hookManager: {
            getConfiguration: () => ({
              WorktreeRemove: [{ hooks: [{ command: "cleanup.sh" }] }],
            }),
          } as never,
          messageManager: {} as never,
        };

        const result = await exitWorktreeTool.execute(
          { action: "remove" },
          contextWithHookManager,
        );

        expect(result.success).toBe(true);
        expect(result.content).toContain("Exited and removed worktree");
        expect(result.content).not.toContain(
          "WorktreeRemove hooks were executed",
        );
        expect(worktreeUtils.removeWorktree).toHaveBeenCalled();
        expect(worktreeHooks.executeWorktreeRemoveHook).not.toHaveBeenCalled();
      });
    });
  });
});
