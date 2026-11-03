/**
 * 「最近目录」条目的两行式拆分（`splitWorkdir`）。
 *
 * 远端主机的目录拼写跟着机器走：macOS/Linux 是 `/Users/a/repo`，Windows 是
 * 系统原生的 `C:\Users\a\repo`；而 worktree 会话的目录来自 `git worktree list`
 * （正斜杠）。两种分隔符都得认，否则目录名那行会漏出整条路径——远控页新建
 * 对话弹窗曾经只按 `/` 切，Windows 主机上就是这么坏的。
 */
import { describe, expect, it } from "vitest";
import { splitWorkdir } from "../../src/utils/workdirPath";

describe("splitWorkdir", () => {
  it("splits a POSIX path into name and parent", () => {
    expect(splitWorkdir("/Users/alice/code/wave-agent")).toEqual({
      name: "wave-agent",
      parent: "/Users/alice/code",
    });
  });

  it("splits a Windows path on backslashes", () => {
    expect(splitWorkdir("C:\\Users\\liuyiqi02\\github\\wave-agent")).toEqual({
      name: "wave-agent",
      parent: "C:\\Users\\liuyiqi02\\github",
    });
  });

  it("splits a mixed-separator path (git worktree list output on Windows)", () => {
    expect(splitWorkdir("C:/Users/liuyiqi02/github/wave-agent")).toEqual({
      name: "wave-agent",
      parent: "C:/Users/liuyiqi02/github",
    });
  });

  it("keeps a drive root's separator instead of leaving a bare `C:`", () => {
    expect(splitWorkdir("C:\\Users")).toEqual({
      name: "Users",
      parent: "C:\\",
    });
  });

  it("ignores trailing separators", () => {
    expect(splitWorkdir("/repo/")).toEqual({ name: "repo", parent: "" });
    expect(splitWorkdir("C:\\repo\\")).toEqual({
      name: "repo",
      parent: "C:\\",
    });
  });

  it("returns the input as its own name when there is no separator", () => {
    expect(splitWorkdir("repo")).toEqual({ name: "repo", parent: "" });
  });
});
