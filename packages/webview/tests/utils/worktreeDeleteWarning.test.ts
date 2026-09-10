import { describe, it, expect } from "vitest";
import {
  worktreeDeleteWarning,
  WORKTREE_DELETE_CHECKING,
} from "../../src/utils/worktreeDeleteWarning";

describe("worktreeDeleteWarning", () => {
  it("names the uncommitted files and the unrecoverable loss", () => {
    const text = worktreeDeleteWarning({ files: 3, commits: 0 });

    expect(text).toContain("3 个未提交文件");
    expect(text).toContain("删除后不可恢复");
    // No commits to report — do not claim the branch had any.
    expect(text).not.toContain("未合并提交");
  });

  it("names the commits and the branch that will be deleted", () => {
    const text = worktreeDeleteWarning({ files: 0, commits: 2 });

    expect(text).toContain("2 个未合并提交");
    expect(text).toContain("临时分支");
    expect(text).not.toContain("未提交文件");
  });

  it("reports both counts when both exist", () => {
    const text = worktreeDeleteWarning({ files: 1, commits: 4 });

    expect(text).toContain("1 个未提交文件");
    expect(text).toContain("4 个未合并提交");
  });

  it("returns undefined for a clean worktree", () => {
    expect(worktreeDeleteWarning({ files: 0, commits: 0 })).toBeUndefined();
  });

  it("warns generically when the worktree could not be inspected", () => {
    // Unknown is not clean: silence here would delete without any warning.
    const text = worktreeDeleteWarning(null);

    expect(text).toContain("未提交的改动将丢失");
  });

  it("marks the checking state with its own text", () => {
    expect(WORKTREE_DELETE_CHECKING).toContain("正在检查");
  });
});
