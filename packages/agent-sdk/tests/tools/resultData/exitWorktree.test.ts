import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs";
import { exitWorktreeTool } from "@/tools/exitWorktreeTool.js";
import {
  renderExitWorktreeResultData,
  type ExitWorktreeResultData,
} from "@/tools/resultData/exitWorktree.js";
import type { ToolContext } from "@/tools/types.js";
import type { WorktreeSession } from "@/utils/worktreeSession.js";
import { TaskManager } from "@/services/taskManager.js";
import { Container } from "@/utils/container.js";
import * as worktreeUtils from "@/utils/worktreeUtils.js";
import * as worktreeHooks from "@/services/worktreeHooks.js";

/**
 * Golden 断言（issue #3055 阶段 1）：`ExitWorktree` 的 `data` 经它自己的渲染器还原
 * 出来的文本，必须与工具当场产出的 `content` **逐字相等**。
 *
 * 期望值是手写的字面量，不是从 `content` 抄来的。措辞照 CC
 * （`ExitWorktreeTool.ts:281` 的 keep、`:318` 的 remove）。
 */

vi.mock("@/utils/worktreeUtils.js");
// `removeWorktree` 被 automock 成空操作，"目录还在不在" 由 `existsSync` 回答 —— 这
// 也是生产里唯一的证人（删除失败不抛错）。只截这一个调用，其余仍是真 fs。
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

/** 渲染 `data` 并断言它逐字等于工具给的 `content`。 */
const expectRendersBack = (result: {
  content: string;
  data?: unknown;
}): void => {
  expect(
    renderExitWorktreeResultData(result.data as ExitWorktreeResultData),
  ).toBe(result.content);
};

describe("ExitWorktree 的 data → 文本 golden", () => {
  let mockContext: ToolContext;
  let mockGetWorktreeSession: ReturnType<typeof vi.fn>;

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

    mockGetWorktreeSession = vi.fn().mockReturnValue(mockSession);

    mockContext = {
      workdir: "/repo/.wave/worktrees/test",
      taskManager: new TaskManager(new Container(), "test-session"),
      aiManager: {
        setCurrentWorkdir: vi.fn(),
        setWorkspaceRoot: vi.fn(),
        getCurrentWorkdir: () => "/repo/.wave/worktrees/test",
        getOriginalWorkdir: () => "/repo",
        getWorktreeSession: mockGetWorktreeSession,
        setWorktreeSession: vi.fn(),
      } as never,
    };
  });

  it("keep：正文说清「留在哪、回到哪」，路径就是退出前的 currentWorkdir", async () => {
    const result = await exitWorktreeTool.execute(
      { action: "keep" },
      mockContext,
    );

    expect(result.content).toBe(
      "Exited worktree. Your work is preserved at /repo/.wave/worktrees/test " +
        "on branch worktree-test. Session is now back in /original/dir.",
    );
    expect(result.data).toEqual({
      action: "keep",
      originalCwd: "/original/dir",
      worktreePath: "/repo/.wave/worktrees/test",
      worktreeBranch: "worktree-test",
    });
    expectRendersBack(result);
  });

  it("keep 且工作树没有分支名：不留 ` on branch` 尾巴", async () => {
    mockGetWorktreeSession.mockReturnValue({
      ...mockSession,
      worktreeBranch: "",
    });

    const result = await exitWorktreeTool.execute(
      { action: "keep" },
      mockContext,
    );

    expect(result.content).toBe(
      "Exited worktree. Your work is preserved at /repo/.wave/worktrees/test. " +
        "Session is now back in /original/dir.",
    );
    expect(result.data).toEqual({
      action: "keep",
      originalCwd: "/original/dir",
      worktreePath: "/repo/.wave/worktrees/test",
    });
    expectRendersBack(result);
  });

  it("remove 且干净：没有 Discarded 那句", async () => {
    vi.mocked(worktreeUtils.countWorktreeChanges).mockReturnValue({
      changedFiles: 0,
      commits: 0,
    });

    const result = await exitWorktreeTool.execute(
      { action: "remove" },
      mockContext,
    );

    expect(result.content).toBe(
      "Exited and removed worktree at /repo/.wave/worktrees/test. " +
        "Session is now back in /original/dir.",
    );
    expect(result.data).toEqual({
      action: "remove",
      originalCwd: "/original/dir",
      worktreePath: "/repo/.wave/worktrees/test",
      worktreeBranch: "worktree-test",
      discardedFiles: 0,
      discardedCommits: 0,
    });
    expectRendersBack(result);
  });

  it("remove 丢弃了改动：commits 在前、files 在后，单复数照 CC", async () => {
    vi.mocked(worktreeUtils.countWorktreeChanges).mockReturnValue({
      changedFiles: 5,
      commits: 3,
    });

    const result = await exitWorktreeTool.execute(
      { action: "remove", discard_changes: true },
      mockContext,
    );

    expect(result.content).toBe(
      "Exited and removed worktree at /repo/.wave/worktrees/test. " +
        "Discarded 3 commits and 5 uncommitted files. " +
        "Session is now back in /original/dir.",
    );
    expect(result.data).toEqual({
      action: "remove",
      originalCwd: "/original/dir",
      worktreePath: "/repo/.wave/worktrees/test",
      worktreeBranch: "worktree-test",
      discardedFiles: 5,
      discardedCommits: 3,
    });
    expectRendersBack(result);
  });

  it("remove 只丢一个提交与一个文件：单数形态", async () => {
    vi.mocked(worktreeUtils.countWorktreeChanges).mockReturnValue({
      changedFiles: 1,
      commits: 1,
    });

    const result = await exitWorktreeTool.execute(
      { action: "remove", discard_changes: true },
      mockContext,
    );

    expect(result.content).toBe(
      "Exited and removed worktree at /repo/.wave/worktrees/test. " +
        "Discarded 1 commit and 1 uncommitted file. " +
        "Session is now back in /original/dir.",
    );
    expectRendersBack(result);
  });

  it("hook 删掉的工作树多一句「hooks 已执行」，靠 removeHook 重建", async () => {
    mockGetWorktreeSession.mockReturnValue({ ...mockSession, hookBased: true });
    vi.mocked(worktreeUtils.countWorktreeChanges).mockReturnValue({
      changedFiles: 0,
      commits: 0,
    });
    vi.mocked(worktreeHooks.executeWorktreeRemoveHook).mockResolvedValue(true);

    const result = await exitWorktreeTool.execute(
      { action: "remove" },
      {
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
      },
    );

    expect(result.content).toBe(
      "Exited and removed worktree at /repo/.wave/worktrees/test. " +
        "Session is now back in /original/dir. WorktreeRemove hooks were executed.",
    );
    expect(result.data).toEqual({
      action: "remove",
      originalCwd: "/original/dir",
      worktreePath: "/repo/.wave/worktrees/test",
      worktreeBranch: "worktree-test",
      discardedFiles: 0,
      discardedCommits: 0,
      removeHook: "executed",
    });
    expectRendersBack(result);
  });

  it("hook 工作树但没配 hook：正文说清工作树留在了原地", async () => {
    mockGetWorktreeSession.mockReturnValue({ ...mockSession, hookBased: true });
    vi.mocked(worktreeUtils.countWorktreeChanges).mockReturnValue({
      changedFiles: 0,
      commits: 0,
    });
    vi.mocked(worktreeHooks.executeWorktreeRemoveHook).mockResolvedValue(false);

    const result = await exitWorktreeTool.execute(
      { action: "remove" },
      {
        ...mockContext,
        hookManager: { getConfiguration: () => undefined } as never,
      },
    );

    expect(result.content).toBe(
      "Exited and removed worktree at /repo/.wave/worktrees/test. " +
        "Session is now back in /original/dir. " +
        "No WorktreeRemove hook configured, hook-based worktree left at the path above.",
    );
    expect(result.data).toEqual({
      action: "remove",
      originalCwd: "/original/dir",
      worktreePath: "/repo/.wave/worktrees/test",
      worktreeBranch: "worktree-test",
      discardedFiles: 0,
      discardedCommits: 0,
      removeHook: "missing",
    });
    expectRendersBack(result);
  });

  it("目录没删掉的失败分支不产 data（口径 6），正文保持原文", async () => {
    vi.mocked(worktreeUtils.countWorktreeChanges).mockReturnValue({
      changedFiles: 0,
      commits: 0,
    });
    vi.mocked(fs.existsSync).mockImplementation(
      (p) => p === mockSession.worktreePath,
    );

    const result = await exitWorktreeTool.execute(
      { action: "remove" },
      mockContext,
    );

    expect(result.success).toBe(false);
    expect(result.data).toBeUndefined();
    expect(result.content).toContain(
      "Exited worktree at /repo/.wave/worktrees/test, but it was not removed.",
    );
  });
});
