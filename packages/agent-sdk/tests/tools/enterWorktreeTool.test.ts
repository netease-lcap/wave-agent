import { describe, it, expect, vi, beforeEach } from "vitest";
import { enterWorktreeTool } from "@/tools/enterWorktreeTool.js";
import type { ToolContext } from "@/tools/types.js";
import { TaskManager } from "@/services/taskManager.js";
import { Container } from "@/utils/container.js";
import * as worktreeSession from "@/utils/worktreeSession.js";
import * as worktreeUtils from "@/utils/worktreeUtils.js";
import * as gitUtils from "@/utils/gitUtils.js";

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
  };
});
vi.mock("@/utils/worktreeSession.js");

describe("enterWorktreeTool", () => {
  let mockContext: ToolContext;
  let mockSetWorkdir: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetAllMocks();

    mockSetWorkdir = vi.fn();

    mockContext = {
      workdir: "/test/workdir",
      taskManager: new TaskManager(new Container(), "test-session"),
      aiManager: {
        setWorkdir: mockSetWorkdir,
        getWorkdir: () => "/test/workdir",
      } as never,
    };

    vi.mocked(gitUtils.getGitMainRepoRoot).mockReturnValue("/test/repo");
    vi.mocked(worktreeUtils.getHeadCommit).mockReturnValue("abc123");
    vi.mocked(worktreeSession.getCurrentWorktreeSession).mockReturnValue(null);
  });

  it("should have correct tool configuration", () => {
    expect(enterWorktreeTool.name).toBe("EnterWorktree");
    expect(enterWorktreeTool.config.function.name).toBe("EnterWorktree");
    expect(enterWorktreeTool.config.function.description).toContain("worktree");
    expect(enterWorktreeTool.config.type).toBe("function");
    expect(enterWorktreeTool.prompt?.()).toContain("worktree");
  });

  it("should reject when already in a worktree session", async () => {
    vi.mocked(worktreeSession.getCurrentWorktreeSession).mockReturnValue({
      originalCwd: "/original",
      worktreePath: "/repo/.wave/worktrees/other",
      worktreeBranch: "worktree-other",
      worktreeName: "other",
      isNew: true,
      repoRoot: "/repo",
      hookBased: false,
    });

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
    expect(worktreeSession.setCurrentWorktreeSession).toHaveBeenCalled();
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

  it("should use hook to create worktree when WorktreeCreate hooks are configured", async () => {
    const mockExecuteHooks = vi.fn().mockResolvedValue([
      {
        success: true,
        stdout: "/test/repo/.wave/worktrees/hook-test",
        exitCode: 0,
        duration: 0,
        timedOut: false,
      },
    ]);
    const mockProcessHookResults = vi.fn();
    const mockGetTranscriptPath = vi
      .fn()
      .mockReturnValue("/test/transcript.jsonl");

    vi.mocked(worktreeUtils.generateWorktreeName).mockReturnValue("hook-test");

    const contextWithHooks: ToolContext = {
      ...mockContext,
      hookManager: {
        executeHooks: mockExecuteHooks,
        processHookResults: mockProcessHookResults,
        hasHooks: vi.fn().mockReturnValue(true),
      } as never,
      messageManager: {
        getTranscriptPath: mockGetTranscriptPath,
      } as never,
      sessionId: "test-session-id",
    };

    const result = await enterWorktreeTool.execute({}, contextWithHooks);

    expect(result.success).toBe(true);
    expect(result.content).toContain("WorktreeCreate hooks were executed");
    expect(result.content).toContain("/test/repo/.wave/worktrees/hook-test");
    expect(mockExecuteHooks).toHaveBeenCalledWith("WorktreeCreate", {
      event: "WorktreeCreate",
      projectDir: "/test/repo",
      timestamp: expect.any(Date),
      sessionId: "test-session-id",
      transcriptPath: "/test/transcript.jsonl",
      cwd: "/test/repo",
      worktreeName: "hook-test",
      mainRepoDir: "/test/repo",
      env: expect.any(Object),
    });
    expect(mockProcessHookResults).toHaveBeenCalledWith(
      "WorktreeCreate",
      expect.any(Array),
      contextWithHooks.messageManager,
    );
    expect(worktreeUtils.createWorktree).not.toHaveBeenCalled();
    expect(mockSetWorkdir).toHaveBeenCalledWith(
      "/test/repo/.wave/worktrees/hook-test",
    );
  });

  it("should return error when hook fails", async () => {
    const mockExecuteHooks = vi.fn().mockResolvedValue([
      {
        success: false,
        stdout: "",
        exitCode: 1,
        stderr: "Hook error",
        duration: 0,
        timedOut: false,
      },
    ]);

    vi.mocked(worktreeUtils.generateWorktreeName).mockReturnValue("fail-hook");

    const contextWithHooks: ToolContext = {
      ...mockContext,
      hookManager: {
        executeHooks: mockExecuteHooks,
        processHookResults: vi.fn(),
        hasHooks: vi.fn().mockReturnValue(true),
      } as never,
      messageManager: { getTranscriptPath: vi.fn() } as never,
    };

    const result = await enterWorktreeTool.execute({}, contextWithHooks);

    expect(result.success).toBe(false);
    expect(result.error).toBe("WorktreeCreate hook failed");
    expect(worktreeUtils.createWorktree).not.toHaveBeenCalled();
  });

  it("should return error when hook produces no path on stdout", async () => {
    const mockExecuteHooks = vi.fn().mockResolvedValue([
      {
        success: true,
        stdout: "",
        exitCode: 0,
        duration: 0,
        timedOut: false,
      },
    ]);

    vi.mocked(worktreeUtils.generateWorktreeName).mockReturnValue("no-path");

    const contextWithHooks: ToolContext = {
      ...mockContext,
      hookManager: {
        executeHooks: mockExecuteHooks,
        processHookResults: vi.fn(),
        hasHooks: vi.fn().mockReturnValue(true),
      } as never,
      messageManager: { getTranscriptPath: vi.fn() } as never,
    };

    const result = await enterWorktreeTool.execute({}, contextWithHooks);

    expect(result.success).toBe(false);
    expect(result.error).toBe("WorktreeCreate hook produced no path");
    expect(worktreeUtils.createWorktree).not.toHaveBeenCalled();
  });

  it("should call createWorktree when no hook is configured", async () => {
    vi.mocked(worktreeUtils.generateWorktreeName).mockReturnValue("no-hook");
    vi.mocked(worktreeUtils.createWorktree).mockReturnValue({
      name: "no-hook",
      path: "/test/repo/.wave/worktrees/no-hook",
      branch: "worktree-no-hook",
      repoRoot: "/test/repo",
      isNew: true,
      originalHeadCommit: "abc123",
    });

    const contextWithHooks: ToolContext = {
      ...mockContext,
      hookManager: {
        executeHooks: vi.fn(),
        processHookResults: vi.fn(),
        hasHooks: vi.fn().mockReturnValue(false),
      } as never,
      messageManager: {} as never,
    };

    const result = await enterWorktreeTool.execute({}, contextWithHooks);

    expect(result.success).toBe(true);
    expect(result.content).toContain("Created worktree");
    expect(result.content).not.toContain("WorktreeCreate hooks were executed");
    expect(worktreeUtils.createWorktree).toHaveBeenCalledWith(
      "no-hook",
      "/test/repo",
    );
  });
});
