import { describe, it, expect, vi, beforeEach } from "vitest";
import { exitWorktreeTool } from "@/tools/exitWorktreeTool.js";
import type { ToolContext } from "@/tools/types.js";
import type { WorktreeSession } from "@/utils/worktreeSession.js";
import { TaskManager } from "@/services/taskManager.js";
import { Container } from "@/utils/container.js";
import * as worktreeUtils from "@/utils/worktreeUtils.js";
import * as worktreeHooks from "@/services/worktreeHooks.js";

vi.mock("@/utils/worktreeUtils.js");
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
    mockGetWorktreeSession = vi.fn().mockReturnValue(null);
    mockSetWorktreeSession = vi.fn();

    mockContext = {
      workdir: "/repo/.wave/worktrees/test",
      taskManager: new TaskManager(new Container(), "test-session"),
      aiManager: {
        setWorkdir: mockSetWorkdir,
        getWorkdir: () => "/repo/.wave/worktrees/test",
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
      expect(result.error).toBe("Worktree has uncommitted changes");
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
      expect(result.error).toBe("Could not verify worktree state");
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
        expect(result.error).toBe("Worktree has uncommitted changes");
        expect(worktreeHooks.executeWorktreeRemoveHook).not.toHaveBeenCalled();
      });

      it("should still refuse removal when worktree state cannot be verified (fail-closed)", async () => {
        vi.mocked(worktreeUtils.countWorktreeChanges).mockReturnValue(null);

        const result = await exitWorktreeTool.execute(
          { action: "remove" },
          contextWithHookManager(),
        );

        expect(result.success).toBe(false);
        expect(result.error).toBe("Could not verify worktree state");
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
