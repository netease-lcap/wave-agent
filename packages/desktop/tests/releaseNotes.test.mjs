import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// git 与文件系统都在测试边界上 mock 掉：这里要验的是「commit 标题 → 记录」的
// 口径，不是 git 本身（真实链路由 publish.yml 冒烟）。
vi.mock("node:child_process", () => ({ execFileSync: vi.fn() }));
vi.mock("node:fs", () => ({
  default: { mkdirSync: vi.fn(), writeFileSync: vi.fn() },
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import {
  buildReleaseNotes,
  formatSubject,
  generateReleaseNotes,
  readCommitSubjects,
  writeNotesFile,
} from "../scripts/release-notes.mjs";

const mockGitLog = (subjects) =>
  vi.mocked(execFileSync).mockReturnValue(`${subjects.join("\n")}\n`);

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("formatSubject", () => {
  it("去掉 type(scope) 前缀，只留正文", () => {
    expect(
      formatSubject(
        "fix(remote): 「电脑侧不在线」点出切换电脑入口，不再只报状态",
      ),
    ).toBe("「电脑侧不在线」点出切换电脑入口，不再只报状态");
    expect(formatSubject("feat: 支持 WSL 发行版作为会话主机")).toBe(
      "支持 WSL 发行版作为会话主机",
    );
  });

  it("尾部 PR 号一条不剩（含重复后缀）；没有 PR 号也照常", () => {
    expect(
      formatSubject(
        "feat(desktop): Windows 关闭窗口最小化到托盘 (#2769) (#2778)",
      ),
    ).toBe("Windows 关闭窗口最小化到托盘");
    expect(formatSubject("feat(desktop): 单分屏时对话顶栏即窗口拖拽区")).toBe(
      "单分屏时对话顶栏即窗口拖拽区",
    );
  });

  it("丢弃 chore/docs/style/test/ci/build 与 bump 提交", () => {
    expect(
      formatSubject(
        "chore: bump wave-desktop to v1.6.1, wave-vscode to v1.6.1",
      ),
    ).toBeNull();
    expect(
      formatSubject("docs(specs): 远控页删除回执语义改为「工作树后台删」"),
    ).toBeNull();
    expect(formatSubject("test(webview): 补一条账户卡片用例")).toBeNull();
    expect(formatSubject("style: 统一引号")).toBeNull();
    expect(formatSubject("ci: 加一条 e2e")).toBeNull();
    expect(formatSubject("build(deps): 升 vite")).toBeNull();
    // 没有 type 前缀的 bump 也要丢
    expect(formatSubject("bump all versions to v1.6.0")).toBeNull();
  });

  it("merge 提交、空标题、只有前缀没有正文的都不进记录", () => {
    expect(formatSubject("Merge pull request #2777 from x/y")).toBeNull();
    expect(formatSubject("   ")).toBeNull();
    expect(formatSubject(undefined)).toBeNull();
    expect(formatSubject("fix: ")).toBeNull();
  });

  it("保留 fix/feat/perf/refactor/revert，未知类型也保留", () => {
    expect(
      formatSubject("refactor(settings): 移除设置页「服务端地址」输入行"),
    ).toBe("移除设置页「服务端地址」输入行");
    expect(formatSubject("revert(desktop): 回滚托盘改动")).toBe("回滚托盘改动");
    expect(formatSubject("unknown: 兜底保留")).toBe("兜底保留");
  });

  it("CRLF 标题不会带出 \\r", () => {
    expect(formatSubject("fix(webview): 复制按钮挪进右上角\r")).toBe(
      "复制按钮挪进右上角",
    );
  });
});

describe("buildReleaseNotes", () => {
  it("平铺成 `- xxx` 列表，保持输入顺序，不加分组/图标/作者", () => {
    const notes = buildReleaseNotes([
      "fix(webview): 账户卡片不再用 apiQuota.limit 反推「额度已用完」 (#2777)",
      "chore: bump wave-desktop to v1.6.1",
      "feat(desktop): Windows 关闭窗口最小化到托盘 (#2769) (#2778)",
    ]);
    expect(notes).toBe(
      [
        "- 账户卡片不再用 apiQuota.limit 反推「额度已用完」",
        "- Windows 关闭窗口最小化到托盘",
      ].join("\n"),
    );
  });

  it("没有可写的提交时返回空串（调用方据此不产出文件）", () => {
    expect(buildReleaseNotes([])).toBe("");
    expect(buildReleaseNotes(["chore: bump", "docs: x"])).toBe("");
  });
});

describe("readCommitSubjects", () => {
  it("按 tag 区间取 commit 标题，排除 merge 提交，逐行拆分", () => {
    mockGitLog(["fix(remote): 区间内的修复 (#100)", "feat: 区间内的新功能"]);
    const subjects = readCommitSubjects(
      "wave-desktop@1.0.0",
      "wave-desktop@1.1.0",
      "/repo",
    );

    expect(subjects).toEqual([
      "fix(remote): 区间内的修复 (#100)",
      "feat: 区间内的新功能",
    ]);
    expect(vi.mocked(execFileSync)).toHaveBeenCalledWith(
      "git",
      [
        "log",
        "--no-merges",
        "--pretty=format:%s",
        "wave-desktop@1.0.0..wave-desktop@1.1.0",
      ],
      expect.objectContaining({ cwd: "/repo", encoding: "utf8" }),
    );
  });
});

describe("generateReleaseNotes", () => {
  it("区间内有可写提交时产出记录（区间外的提交自然不出现）", () => {
    mockGitLog([
      "fix(remote): 区间内的修复 (#100)",
      "docs: 只在区间内的文档",
      "feat(webview): 区间内的新功能",
    ]);
    expect(
      generateReleaseNotes("wave-desktop@1.0.0", "wave-desktop@1.1.0"),
    ).toBe(["- 区间内的修复", "- 区间内的新功能"].join("\n"));
  });

  it("没有上一个 tag（第一个版本）时不调 git、产出空串", () => {
    expect(generateReleaseNotes("")).toBe("");
    expect(vi.mocked(execFileSync)).not.toHaveBeenCalled();
  });
});

describe("writeNotesFile", () => {
  it("有内容时建目录并写文件（末尾换行）", () => {
    expect(writeNotesFile("/out/notes.md", "- 一条")).toBe(true);
    expect(vi.mocked(fs.writeFileSync)).toHaveBeenCalledWith(
      "/out/notes.md",
      "- 一条\n",
      "utf8",
    );
  });

  it("没有内容时不写文件（不产出空文件冒充有记录）", () => {
    expect(writeNotesFile("/out/notes.md", "")).toBe(false);
    expect(vi.mocked(fs.writeFileSync)).not.toHaveBeenCalled();
  });
});
