import { describe, it, expect, vi, beforeEach } from "vitest";
import { enterWorktreeTool } from "@/tools/enterWorktreeTool.js";
import type { ToolContext } from "@/tools/types.js";
import type { WorktreeSession } from "@/utils/worktreeSession.js";
import { TaskManager } from "@/services/taskManager.js";
import { Container } from "@/utils/container.js";
import * as worktreeUtils from "@/utils/worktreeUtils.js";
import * as gitUtils from "@/utils/gitUtils.js";
import * as worktreeHooks from "@/services/worktreeHooks.js";

vi.mock("@/utils/gitUtils.js");
vi.mock("@/utils/worktreeUtils.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/utils/worktreeUtils.js")>();
  return {
    ...actual,
    createWorktree: vi.fn(),
    getHeadCommit: vi.fn(),
    generateWorktreeName: vi.fn(),
    removeWorktree: vi.fn(),
    countWorktreeChanges: vi.fn(),
    performPostCreationSetup: vi.fn(),
  };
});
vi.mock("@/services/worktreeHooks.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/services/worktreeHooks.js")>();
  return {
    ...actual,
    executeWorktreeCreateHook: vi.fn(),
    hasWorktreeCreateHook: vi.fn(),
  };
});

describe("enterWorktreeTool", () => {
  let mockContext: ToolContext;
  let mockSetWorkdir: ReturnType<typeof vi.fn>;
  let mockGetWorktreeSession: ReturnType<typeof vi.fn>;
  let mockSetWorktreeSession: ReturnType<typeof vi.fn>;
  let mockGetWorktreeBaseRef: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetAllMocks();

    mockSetWorkdir = vi.fn();
    mockGetWorktreeSession = vi.fn().mockReturnValue(null);
    mockSetWorktreeSession = vi.fn();
    mockGetWorktreeBaseRef = vi.fn().mockReturnValue("fresh");

    mockContext = {
      workdir: "/test/workdir",
      taskManager: new TaskManager(new Container(), "test-session"),
      aiManager: {
        setWorkdir: mockSetWorkdir,
        getWorkdir: () => "/test/workdir",
        getWorktreeSession: mockGetWorktreeSession,
        setWorktreeSession: mockSetWorktreeSession,
        getWorktreeBaseRef: mockGetWorktreeBaseRef,
      } as never,
    };

    vi.mocked(gitUtils.getGitMainRepoRoot).mockReturnValue("/test/repo");
    vi.mocked(worktreeUtils.getHeadCommit).mockReturnValue("abc123");
  });

  it("should have correct tool configuration", () => {
    expect(enterWorktreeTool.name).toBe("EnterWorktree");
    expect(enterWorktreeTool.config.function.name).toBe("EnterWorktree");
    expect(enterWorktreeTool.config.function.description).toContain("worktree");
    expect(enterWorktreeTool.config.type).toBe("function");
    expect(enterWorktreeTool.prompt?.()).toContain("worktree");
  });

  it("should reject when already in a worktree session", async () => {
    mockGetWorktreeSession.mockReturnValue({
      originalCwd: "/original",
      worktreePath: "/repo/.wave/worktrees/other",
      worktreeBranch: "worktree-other",
      worktreeName: "other",
      isNew: true,
      repoRoot: "/repo",
    } satisfies WorktreeSession);

    const result = await enterWorktreeTool.execute({}, mockContext);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Already in a worktree session");
  });

  it("should reject when not in a git repository", async () => {
    vi.mocked(gitUtils.getGitMainRepoRoot).mockReturnValue("" as never);
    vi.mocked(worktreeUtils.generateWorktreeName).mockReturnValue(
      "auto-name-123",
    );

    const result = await enterWorktreeTool.execute({}, mockContext);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Not in a git repository");
  });

  it("should create worktree with auto-generated name", async () => {
    vi.mocked(worktreeUtils.generateWorktreeName).mockReturnValue(
      "auto-name-123",
    );
    vi.mocked(worktreeUtils.createWorktree).mockReturnValue({
      name: "auto-name-123",
      path: "/test/repo/.wave/worktrees/auto-name-123",
      branch: "worktree-auto-name-123",
      repoRoot: "/test/repo",
      isNew: true,
      originalHeadCommit: "abc123",
    });

    const result = await enterWorktreeTool.execute({}, mockContext);

    expect(result.success).toBe(true);
    expect(result.content).toContain("Created worktree");
    expect(result.content).toContain(
      "/test/repo/.wave/worktrees/auto-name-123",
    );
    expect(mockSetWorkdir).toHaveBeenCalledWith(
      "/test/repo/.wave/worktrees/auto-name-123",
    );
    expect(mockSetWorktreeSession).toHaveBeenCalledWith(
      expect.objectContaining({
        worktreePath: "/test/repo/.wave/worktrees/auto-name-123",
        worktreeName: "auto-name-123",
        worktreeBranch: "worktree-auto-name-123",
      }),
    );
  });

  it("should create worktree with user-provided name", async () => {
    vi.mocked(worktreeUtils.createWorktree).mockReturnValue({
      name: "my-feature",
      path: "/test/repo/.wave/worktrees/my-feature",
      branch: "worktree-my-feature",
      repoRoot: "/test/repo",
      isNew: true,
      originalHeadCommit: "abc123",
    });

    const result = await enterWorktreeTool.execute(
      { name: "my-feature" },
      mockContext,
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("my-feature");
    expect(mockSetWorkdir).toHaveBeenCalledWith(
      "/test/repo/.wave/worktrees/my-feature",
    );
  });

  it("should reject invalid worktree name", async () => {
    const result = await enterWorktreeTool.execute(
      { name: "../escape" },
      mockContext,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid worktree name");
  });

  it("should reuse existing worktree if directory exists", async () => {
    vi.mocked(worktreeUtils.createWorktree).mockReturnValue({
      name: "existing",
      path: "/test/repo/.wave/worktrees/existing",
      branch: "worktree-existing",
      repoRoot: "/test/repo",
      isNew: false,
      originalHeadCommit: "abc123",
    });

    const result = await enterWorktreeTool.execute(
      { name: "existing" },
      mockContext,
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("Created worktree");
  });

  describe("WorktreeCreate hook (replace semantics)", () => {
    beforeEach(() => {
      vi.mocked(worktreeHooks.hasWorktreeCreateHook).mockReturnValue(true);
      vi.mocked(worktreeHooks.executeWorktreeCreateHook).mockResolvedValue({
        worktreePath: "/hook/path/feature",
      });
    });

    function contextWithHookManager(): ToolContext {
      return {
        ...mockContext,
        hookManager: {
          getConfiguration: () => ({
            WorktreeCreate: [{ hooks: [{ command: "create.sh" }] }],
          }),
        } as never,
        messageManager: {
          getTranscriptPath: () => "/test/transcript.jsonl",
        } as never,
        sessionId: "test-session-id",
      };
    }

    it("should create worktree via hook when WorktreeCreate hook is configured", async () => {
      const result = await enterWorktreeTool.execute(
        { name: "feature" },
        contextWithHookManager(),
      );

      expect(result.success).toBe(true);
      expect(result.content).toContain(
        "Created worktree at /hook/path/feature",
      );
      expect(result.content).toContain("WorktreeCreate hooks were executed");
      // Hook replaced git: no git worktree creation, no post-creation setup
      expect(worktreeUtils.createWorktree).not.toHaveBeenCalled();
      expect(worktreeUtils.performPostCreationSetup).not.toHaveBeenCalled();
      expect(worktreeHooks.executeWorktreeCreateHook).toHaveBeenCalledWith(
        "feature",
        expect.objectContaining({
          WorktreeCreate: expect.any(Array),
        }),
        expect.objectContaining({
          projectDir: "/test/workdir",
          sessionId: "test-session-id",
          transcriptPath: "/test/transcript.jsonl",
        }),
      );
    });

    it("should switch the session into the hook-provided path and mark it hook-based", async () => {
      const result = await enterWorktreeTool.execute(
        { name: "feature" },
        contextWithHookManager(),
      );

      expect(result.success).toBe(true);
      expect(mockSetWorkdir).toHaveBeenCalledWith("/hook/path/feature");
      expect(mockSetWorktreeSession).toHaveBeenCalledWith(
        expect.objectContaining({
          originalCwd: "/test/workdir",
          worktreePath: "/hook/path/feature",
          worktreeName: "feature",
          isNew: true,
          hookBased: true,
        }),
      );
    });

    it("should succeed in non-git directories when a WorktreeCreate hook is configured", async () => {
      vi.mocked(gitUtils.getGitMainRepoRoot).mockReturnValue("" as never);

      const result = await enterWorktreeTool.execute(
        { name: "feature" },
        contextWithHookManager(),
      );

      expect(result.success).toBe(true);
      expect(result.content).toContain(
        "Created worktree at /hook/path/feature",
      );
    });

    it("should return failure when the WorktreeCreate hook fails", async () => {
      vi.mocked(worktreeHooks.executeWorktreeCreateHook).mockRejectedValue(
        new Error("WorktreeCreate hook failed: create.sh: boom"),
      );

      const result = await enterWorktreeTool.execute(
        { name: "feature" },
        contextWithHookManager(),
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("WorktreeCreate hook failed");
      expect(result.content).toContain(
        "WorktreeCreate hook failed: create.sh: boom",
      );
      expect(mockSetWorkdir).not.toHaveBeenCalled();
      expect(mockSetWorktreeSession).not.toHaveBeenCalled();
    });

    it("should fall back to git when no WorktreeCreate hook is configured", async () => {
      vi.mocked(worktreeHooks.hasWorktreeCreateHook).mockReturnValue(false);
      vi.mocked(worktreeUtils.createWorktree).mockReturnValue({
        name: "git-based",
        path: "/test/repo/.wave/worktrees/git-based",
        branch: "worktree-git-based",
        repoRoot: "/test/repo",
        isNew: true,
        originalHeadCommit: "abc123",
      });

      const contextWithoutHook: ToolContext = {
        ...mockContext,
        hookManager: undefined,
      };

      const result = await enterWorktreeTool.execute(
        { name: "git-based" },
        contextWithoutHook,
      );

      expect(result.success).toBe(true);
      expect(worktreeUtils.createWorktree).toHaveBeenCalled();
      expect(worktreeHooks.executeWorktreeCreateHook).not.toHaveBeenCalled();
      const setSessionCall = mockSetWorktreeSession.mock
        .calls[0][0] as WorktreeSession | null;
      expect(setSessionCall).toMatchObject({
        worktreePath: "/test/repo/.wave/worktrees/git-based",
        isNew: true,
      });
      // Git-based sessions are never marked hook-based
      expect(setSessionCall?.hookBased).toBeUndefined();
    });

    it("should NOT run post-creation setup for hook-based worktrees", async () => {
      const result = await enterWorktreeTool.execute(
        { name: "feature" },
        contextWithHookManager(),
      );

      expect(result.success).toBe(true);
      expect(worktreeUtils.performPostCreationSetup).not.toHaveBeenCalled();
    });
  });

  it("should pass baseRef 'head' to createWorktree when aiManager returns 'head'", async () => {
    mockGetWorktreeBaseRef.mockReturnValue("head");
    vi.mocked(worktreeUtils.createWorktree).mockReturnValue({
      name: "head-test",
      path: "/test/repo/.wave/worktrees/head-test",
      branch: "worktree-head-test",
      repoRoot: "/test/repo",
      isNew: true,
      originalHeadCommit: "abc123",
    });

    const result = await enterWorktreeTool.execute(
      { name: "head-test" },
      mockContext,
    );

    expect(result.success).toBe(true);
    expect(worktreeUtils.createWorktree).toHaveBeenCalledWith(
      "head-test",
      "/test/repo",
      { baseRef: "head" },
    );
  });

  it("should pass baseRef 'fresh' to createWorktree when aiManager returns 'fresh'", async () => {
    mockGetWorktreeBaseRef.mockReturnValue("fresh");
    vi.mocked(worktreeUtils.createWorktree).mockReturnValue({
      name: "fresh-test",
      path: "/test/repo/.wave/worktrees/fresh-test",
      branch: "worktree-fresh-test",
      repoRoot: "/test/repo",
      isNew: true,
      originalHeadCommit: "abc123",
    });

    const result = await enterWorktreeTool.execute(
      { name: "fresh-test" },
      mockContext,
    );

    expect(result.success).toBe(true);
    expect(worktreeUtils.createWorktree).toHaveBeenCalledWith(
      "fresh-test",
      "/test/repo",
      { baseRef: "fresh" },
    );
  });

  it("should pass undefined baseRef when aiManager has no getWorktreeBaseRef", async () => {
    // Simulate an aiManager without getWorktreeBaseRef (e.g. older SDK consumer)
    vi.mocked(worktreeUtils.createWorktree).mockReturnValue({
      name: "no-ref",
      path: "/test/repo/.wave/worktrees/no-ref",
      branch: "worktree-no-ref",
      repoRoot: "/test/repo",
      isNew: true,
      originalHeadCommit: "abc123",
    });

    const contextNoBaseRef: ToolContext = {
      ...mockContext,
      aiManager: {
        setWorkdir: mockSetWorkdir,
        getWorkdir: () => "/test/workdir",
        getWorktreeSession: mockGetWorktreeSession,
        setWorktreeSession: mockSetWorktreeSession,
      } as never,
    };

    const result = await enterWorktreeTool.execute(
      { name: "no-ref" },
      contextNoBaseRef,
    );

    expect(result.success).toBe(true);
    expect(worktreeUtils.createWorktree).toHaveBeenCalledWith(
      "no-ref",
      "/test/repo",
      { baseRef: undefined },
    );
  });

  it("should run post-creation setup when a new worktree is created", async () => {
    vi.mocked(worktreeUtils.generateWorktreeName).mockReturnValue(
      "auto-name-123",
    );
    vi.mocked(worktreeUtils.createWorktree).mockReturnValue({
      name: "fresh",
      path: "/test/repo/.wave/worktrees/fresh",
      branch: "worktree-fresh",
      repoRoot: "/test/repo",
      isNew: true,
      originalHeadCommit: "abc123",
    });

    const result = await enterWorktreeTool.execute({}, mockContext);

    expect(result.success).toBe(true);
    expect(worktreeUtils.performPostCreationSetup).toHaveBeenCalledWith(
      "/test/repo/.wave/worktrees/fresh",
      "/test/repo",
    );
  });

  it("should NOT run post-creation setup when an existing worktree is reused", async () => {
    vi.mocked(worktreeUtils.createWorktree).mockReturnValue({
      name: "existing",
      path: "/test/repo/.wave/worktrees/existing",
      branch: "worktree-existing",
      repoRoot: "/test/repo",
      isNew: false,
      originalHeadCommit: "abc123",
    });

    const result = await enterWorktreeTool.execute(
      { name: "existing" },
      mockContext,
    );

    expect(result.success).toBe(true);
    expect(worktreeUtils.performPostCreationSetup).not.toHaveBeenCalled();
  });

  it("should not fail the tool when post-creation setup throws", async () => {
    vi.mocked(worktreeUtils.generateWorktreeName).mockReturnValue(
      "auto-name-123",
    );
    vi.mocked(worktreeUtils.createWorktree).mockReturnValue({
      name: "setup-error",
      path: "/test/repo/.wave/worktrees/setup-error",
      branch: "worktree-setup-error",
      repoRoot: "/test/repo",
      isNew: true,
      originalHeadCommit: "abc123",
    });
    vi.mocked(worktreeUtils.performPostCreationSetup).mockRejectedValue(
      new Error("setup failed"),
    );

    const result = await enterWorktreeTool.execute({}, mockContext);

    expect(result.success).toBe(true);
    expect(result.content).toContain("Created worktree");
  });
});
