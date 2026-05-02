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
});
