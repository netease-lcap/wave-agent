import { describe, it, expect, vi, beforeEach } from "vitest";
import { exitWorktreeTool } from "@/tools/exitWorktreeTool.js";
import type { ToolContext } from "@/tools/types.js";
import type { WorktreeSession } from "@/utils/worktreeSession.js";
import { TaskManager } from "@/services/taskManager.js";
import { Container } from "@/utils/container.js";
import * as worktreeUtils from "@/utils/worktreeUtils.js";

vi.mock("@/utils/worktreeUtils.js");

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

    it("should trigger WorktreeRemove hooks when hookManager is available", async () => {
      const mockExecuteHooks = vi.fn().mockResolvedValue([]);
      const mockProcessHookResults = vi.fn();
      const mockGetTranscriptPath = vi
        .fn()
        .mockReturnValue("/test/transcript.jsonl");

      vi.mocked(worktreeUtils.countWorktreeChanges).mockReturnValue({
        changedFiles: 0,
        commits: 0,
      });

      const contextWithHooks: ToolContext = {
        ...mockContext,
        hookManager: {
          executeHooks: mockExecuteHooks,
          processHookResults: mockProcessHookResults,
        } as never,
        messageManager: {
          getTranscriptPath: mockGetTranscriptPath,
        } as never,
        sessionId: "test-session-id",
      };

      const result = await exitWorktreeTool.execute(
        { action: "remove" },
        contextWithHooks,
      );

      expect(result.success).toBe(true);
      expect(result.content).toContain("WorktreeRemove hooks were executed");
      expect(mockExecuteHooks).toHaveBeenCalledWith("WorktreeRemove", {
        event: "WorktreeRemove",
        projectDir: "/original/dir",
        timestamp: expect.any(Date),
        sessionId: "test-session-id",
        transcriptPath: "/test/transcript.jsonl",
        cwd: "/original/dir",
        worktreePath: "/repo/.wave/worktrees/test",
        env: expect.any(Object),
      });
      expect(mockProcessHookResults).toHaveBeenCalledWith(
        "WorktreeRemove",
        [],
        contextWithHooks.messageManager,
      );
    });

    it("should NOT trigger hooks when hookManager is not available", async () => {
      const mockExecuteHooks = vi.fn().mockResolvedValue([]);

      vi.mocked(worktreeUtils.countWorktreeChanges).mockReturnValue({
        changedFiles: 0,
        commits: 0,
      });

      const contextWithoutHooks: ToolContext = {
        ...mockContext,
        hookManager: undefined,
        messageManager: {} as never,
      };

      const result = await exitWorktreeTool.execute(
        { action: "remove" },
        contextWithoutHooks,
      );

      expect(result.success).toBe(true);
      expect(result.content).not.toContain(
        "WorktreeRemove hooks were executed",
      );
      expect(mockExecuteHooks).not.toHaveBeenCalled();
    });

    it("should not fail tool when hooks throw an error", async () => {
      const mockExecuteHooks = vi
        .fn()
        .mockRejectedValue(new Error("Hook execution failed"));

      vi.mocked(worktreeUtils.countWorktreeChanges).mockReturnValue({
        changedFiles: 0,
        commits: 0,
      });

      const contextWithHooks: ToolContext = {
        ...mockContext,
        hookManager: {
          executeHooks: mockExecuteHooks,
          processHookResults: vi.fn(),
        } as never,
        messageManager: {} as never,
      };

      const result = await exitWorktreeTool.execute(
        { action: "remove" },
        contextWithHooks,
      );

      expect(result.success).toBe(true);
      expect(result.content).toContain("Exited and removed worktree");
      expect(result.content).not.toContain(
        "WorktreeRemove hooks were executed",
      );
    });

    it("should NOT trigger WorktreeRemove hooks when action is keep", async () => {
      const mockExecuteHooks = vi.fn().mockResolvedValue([]);

      const contextWithHooks: ToolContext = {
        ...mockContext,
        hookManager: {
          executeHooks: mockExecuteHooks,
          processHookResults: vi.fn(),
        } as never,
        messageManager: {} as never,
      };

      vi.mocked(worktreeUtils.countWorktreeChanges).mockReturnValue({
        changedFiles: 0,
        commits: 0,
      });

      mockGetWorktreeSession.mockReturnValue(mockSession);

      const result = await exitWorktreeTool.execute(
        { action: "keep" },
        contextWithHooks,
      );

      expect(result.success).toBe(true);
      expect(mockExecuteHooks).not.toHaveBeenCalled();
    });
  });
});
