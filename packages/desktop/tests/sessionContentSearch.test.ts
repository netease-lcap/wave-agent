/**
 * 侧栏内容搜索（spec desktop-sessions.md「侧栏会话内容搜索」）。
 *
 * fs 全部走 mock：这一层要验的是「读哪些行、取哪些字段、截断与上限怎么算」，
 * 不是 Node 的文件系统本身。真实转录的形状按 SDK 的 JSONL 写入口径造——一行一个
 * `Message`，reserved 条目（metadata / custom-title）没有 blocks。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { basename, dirname, join, relative, resolve } from "path";

const readdir = vi.fn();
const stat = vi.fn();
const readFile = vi.fn();

vi.mock("fs", () => ({
  promises: { readdir, stat, readFile },
}));

const { searchSessionContents, selectLocalSessionIds } = await import(
  "../src/main/sessionContentSearch.js"
);

const SESSION_A = "11111111-1111-4111-8111-111111111111";
const SESSION_B = "22222222-2222-4222-8222-222222222222";

/** 转录根目录与 mock 键都用 `path` 拼：`check-windows` 上两者必须是同一套分隔符。 */
const SESSION_DIR = resolve("/projects");
const sessionFile = (sessionId: string) => join("a", `${sessionId}.jsonl`);

const line = (blocks: unknown[], extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    id: "m1",
    role: "assistant",
    timestamp: "2026-01-01T00:00:00.000Z",
    blocks,
    ...extra,
  });

const setupFiles = (files: Record<string, string>) => {
  readdir.mockImplementation(async (dir: string) => {
    if (dir === SESSION_DIR) {
      // 顶层是项目目录名，不是文件。
      return [...new Set(Object.keys(files).map((f) => dirname(f)))];
    }
    const dirName = basename(dir);
    return Object.keys(files)
      .filter((f) => dirname(f) === dirName)
      .map((f) => basename(f));
  });
  readFile.mockImplementation(async (file: string) => {
    const key = relative(SESSION_DIR, file);
    if (!(key in files)) throw new Error("ENOENT");
    return files[key];
  });
  stat.mockResolvedValue({ size: 1024 });
};

const search = (query: string, ids: string[] = [SESSION_A, SESSION_B]) =>
  searchSessionContents(query, {
    sessionIds: new Set(ids),
    sessionDir: SESSION_DIR,
  });

describe("searchSessionContents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("命中正文、思考与工具输出，并给出片段与总数", async () => {
    setupFiles({
      [sessionFile(SESSION_A)]: [
        line([{ type: "text", content: "先看 webview 的状态" }]),
        line([{ type: "reasoning", content: "webview 需要改" }]),
        line([
          { type: "tool", name: "Bash", stage: "end", result: "src/webview/x" },
        ]),
      ].join("\n"),
    });

    const result = await search("webview");

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].sessionId).toBe(SESSION_A);
    expect(result.matches[0].hitCount).toBe(3);
    // 片段最多三条，每条都带命中位置与「会话内第几个命中」。
    expect(result.matches[0].snippets).toHaveLength(3);
    expect(result.matches[0].snippets.map((s) => s.hitIndex)).toEqual([
      0, 1, 2,
    ]);
    for (const snippet of result.matches[0].snippets) {
      expect(
        snippet.text.slice(snippet.offset, snippet.offset + snippet.length),
      ).toBe("webview");
    }
  });

  it("只认本地会话 id，其余文件读了也不算", async () => {
    setupFiles({
      [sessionFile(SESSION_A)]: line([{ type: "text", content: "needle" }]),
      [sessionFile(SESSION_B)]: line([{ type: "text", content: "needle" }]),
    });

    const result = await search("needle", [SESSION_A]);

    expect(result.matches.map((m) => m.sessionId)).toEqual([SESSION_A]);
    // 不在名单里的文件连读都不读。
    expect(readFile).toHaveBeenCalledTimes(1);
  });

  it("reserved 条目与坏行不贡献命中", async () => {
    setupFiles({
      [sessionFile(SESSION_A)]: [
        JSON.stringify({ type: "metadata", keyword: "needle" }),
        JSON.stringify({ type: "custom-title", customTitle: "needle" }),
        "{ this is not json",
        line([{ type: "text", content: "真正的 needle" }]),
      ].join("\n"),
    });

    const result = await search("needle");

    expect(result.matches[0].hitCount).toBe(1);
  });

  it("子串不区分大小写，多处命中计入同一会话", async () => {
    setupFiles({
      [sessionFile(SESSION_A)]: line([
        { type: "text", content: "Alpha alpha ALPHA" },
      ]),
    });

    const result = await search("alpha");

    expect(result.matches[0].hitCount).toBe(3);
    // 片段条数有上限，但总数不因此变少。
    expect(result.matches[0].snippets).toHaveLength(3);
  });

  it("片段截断上下文并把换行折成空格", async () => {
    setupFiles({
      [sessionFile(SESSION_A)]: line([
        {
          type: "text",
          content: `${"前".repeat(80)}\n\n第一行\n第二行 needle 尾巴${"后".repeat(80)}`,
        },
      ]),
    });

    const result = await search("needle");
    const [snippet] = result.matches[0].snippets;

    expect(snippet.text).not.toContain("\n");
    expect(snippet.text.length).toBeLessThan(120);
    expect(
      snippet.text.slice(snippet.offset, snippet.offset + snippet.length),
    ).toBe("needle");
  });

  it("关键词短于两个字符直接返回空（不扫盘）", async () => {
    setupFiles({});

    expect(await search("查")).toEqual({ matches: [], truncated: false });
    expect(readdir).not.toHaveBeenCalled();
  });

  it("已取消的查询不读文件", async () => {
    setupFiles({
      [sessionFile(SESSION_A)]: line([{ type: "text", content: "needle" }]),
    });

    const result = await searchSessionContents("needle", {
      sessionIds: new Set([SESSION_A]),
      sessionDir: SESSION_DIR,
      isCancelled: () => true,
    });

    expect(result.matches).toEqual([]);
    expect(readFile).not.toHaveBeenCalled();
  });

  it("缺席的会话文件与读失败都不会让整次搜索失败", async () => {
    setupFiles({
      [sessionFile(SESSION_A)]: line([{ type: "text", content: "needle" }]),
    });
    readFile.mockImplementation(async (file: string) => {
      if (file.includes(SESSION_A))
        return line([{ type: "text", content: "needle" }]);
      throw new Error("EACCES");
    });

    const result = await search("needle");

    expect(result.matches.map((m) => m.sessionId)).toEqual([SESSION_A]);
  });
});

describe("selectLocalSessionIds（哪些会话参与正文搜索）", () => {
  const tree = [
    {
      host: "local",
      sessions: [{ sessionId: "a" }, { sessionId: "b" }],
    },
    {
      host: "build-box",
      sessions: [{ sessionId: "r1" }],
    },
  ];

  it("只留本机会话（远端转录在远端 daemon 的盘上，读不到）", () => {
    expect([...selectLocalSessionIds(tree, undefined, "local")]).toEqual([
      "a",
      "b",
    ]);
  });

  it("给了 requestedIds 就与它取交集（标题搜索/筛选后的树）", () => {
    expect([...selectLocalSessionIds(tree, ["b", "r1"], "local")]).toEqual([
      "b",
    ]);
  });

  it("requestedIds 为空数组时不回退成「全部」", () => {
    expect(selectLocalSessionIds(tree, [], "local").size).toBe(0);
  });
});
