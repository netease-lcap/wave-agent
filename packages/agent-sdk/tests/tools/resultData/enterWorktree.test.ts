import { describe, it, expect, vi, beforeEach } from "vitest";
import { enterWorktreeTool } from "@/tools/enterWorktreeTool.js";
import {
  renderEnterWorktreeResultData,
  type EnterWorktreeResultData,
} from "@/tools/resultData/enterWorktree.js";
import type { ToolContext } from "@/tools/types.js";
import { TaskManager } from "@/services/taskManager.js";
import { Container } from "@/utils/container.js";
import * as worktreeUtils from "@/utils/worktreeUtils.js";
import * as gitUtils from "@/utils/gitUtils.js";
import * as worktreeHooks from "@/services/worktreeHooks.js";

/**
 * Golden 断言（issue #3055 阶段 1）：`EnterWorktree` 的 `data` 经它自己的渲染器
 * 还原出来的文本，必须与工具当场产出的 `content` **逐字相等**。
 *
 * 期望值是手写的字面量，不是从 `content` 抄来的：抄一遍只能证明两边用了同一个渲染
 * 器，证明不了措辞没漂。措辞照 CC（`EnterWorktreeTool.ts:116` 的 `message`）。
 */

vi.mock("@/utils/gitUtils.js");
vi.mock("@/utils/worktreeUtils.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/utils/worktreeUtils.js")>();
  return {
    ...actual,
    createWorktree: vi.fn(),
    generateWorktreeName: vi.fn(),
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

/** 渲染 `data` 并断言它逐字等于工具给的 `content`。 */
const expectRendersBack = (result: {
  content: string;
  data?: unknown;
}): void => {
  expect(
    renderEnterWorktreeResultData(result.data as EnterWorktreeResultData),
  ).toBe(result.content);
};

describe("EnterWorktree 的 data → 文本 golden", () => {
  let mockContext: ToolContext;

  beforeEach(() => {
    vi.resetAllMocks();

    mockContext = {
      workdir: "/test/workdir",
      taskManager: new TaskManager(new Container(), "test-session"),
      aiManager: {
        setCurrentWorkdir: vi.fn(),
        setWorkspaceRoot: vi.fn(),
        getCurrentWorkdir: () => "/test/workdir",
        getOriginalWorkdir: () => "/test/workdir",
        getWorktreeSession: vi.fn().mockReturnValue(null),
        setWorktreeSession: vi.fn(),
        getWorktreeBaseRef: vi.fn().mockReturnValue("fresh"),
      } as never,
    };

    vi.mocked(gitUtils.getGitMainRepoRoot).mockReturnValue("/test/repo");
  });

  it("git 建出来的工作树：正文只说路径与分支，data 只有标量", async () => {
    vi.mocked(worktreeUtils.createWorktree).mockReturnValue({
      name: "feat",
      path: "/test/repo/.wave/worktrees/feat",
      branch: "worktree-feat",
      repoRoot: "/test/repo",
      isNew: true,
      originalHeadCommit: "abc123",
    });

    const result = await enterWorktreeTool.execute(
      { name: "feat" },
      mockContext,
    );

    expect(result.content).toBe(
      "Created worktree at /test/repo/.wave/worktrees/feat on branch worktree-feat. " +
        "The session is now working in the worktree. Use ExitWorktree to leave mid-session, " +
        "or exit the session to be prompted.",
    );
    expect(result.data).toEqual({
      worktreePath: "/test/repo/.wave/worktrees/feat",
      worktreeBranch: "worktree-feat",
      createdViaHook: false,
    });
    expectRendersBack(result);
  });

  it("没有分支名时不留 ` on branch` 尾巴（CC 的 branchInfo 就是空串）", async () => {
    vi.mocked(worktreeUtils.createWorktree).mockReturnValue({
      name: "feat",
      path: "/test/repo/.wave/worktrees/feat",
      branch: "",
      repoRoot: "/test/repo",
      isNew: true,
      originalHeadCommit: "abc123",
    });

    const result = await enterWorktreeTool.execute(
      { name: "feat" },
      mockContext,
    );

    expect(result.content).toBe(
      "Created worktree at /test/repo/.wave/worktrees/feat. " +
        "The session is now working in the worktree. Use ExitWorktree to leave mid-session, " +
        "or exit the session to be prompted.",
    );
    expect(result.data).toEqual({
      worktreePath: "/test/repo/.wave/worktrees/feat",
      createdViaHook: false,
    });
    expectRendersBack(result);
  });

  it("hook 建出来的工作树多一句「hooks 已执行」，靠 createdViaHook 重建", async () => {
    vi.mocked(worktreeHooks.hasWorktreeCreateHook).mockReturnValue(true);
    vi.mocked(worktreeHooks.executeWorktreeCreateHook).mockResolvedValue({
      worktreePath: "/hook/path/feat",
    });

    const result = await enterWorktreeTool.execute(
      { name: "feat" },
      {
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
      },
    );

    expect(result.content).toBe(
      "Created worktree at /hook/path/feat. " +
        "The session is now working in the worktree. Use ExitWorktree to leave mid-session, " +
        "or exit the session to be prompted. WorktreeCreate hooks were executed.",
    );
    expect(result.data).toEqual({
      worktreePath: "/hook/path/feat",
      createdViaHook: true,
    });
    expectRendersBack(result);
  });

  it("失败分支不产 data（口径 6：失败载荷不进 data），正文保持原文", async () => {
    const result = await enterWorktreeTool.execute(
      {},
      {
        ...mockContext,
        aiManager: {
          ...(mockContext.aiManager as object),
          getWorktreeSession: () => ({
            originalCwd: "/original",
            worktreePath: "/repo/.wave/worktrees/other",
            worktreeBranch: "worktree-other",
            worktreeName: "other",
            isNew: true,
            repoRoot: "/repo",
          }),
        } as never,
      },
    );

    expect(result.success).toBe(false);
    expect(result.data).toBeUndefined();
    expect(result.content).toBe(
      "Already in a worktree session. Use ExitWorktree to leave before creating a new one.",
    );
  });
});
