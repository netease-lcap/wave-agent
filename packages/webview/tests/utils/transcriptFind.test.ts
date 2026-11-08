/**
 * 会话内查找的匹配内核（spec ui/transcript-find.md）。
 *
 * 这一层的判据全部是纯函数性质：命中区间、整词边界、零宽正则不卡死、非法表达式
 * 只报错不匹配。高亮那侧（`wrapTextRange`）单独验，两者共用同一套偏移语义。
 */

import { describe, it, expect } from "vitest";
import {
  buildFindRegex,
  clearFindMarks,
  countMessageHits,
  findRanges,
  FIND_HIT_CLASS,
  wrapTextRange,
} from "../../src/utils/transcriptFind";
import type { Message } from "wave-agent-sdk/types";

const NO_TOGGLES = { caseSensitive: false, wholeWord: false, regex: false };

const rangesOf = (
  text: string,
  query: string,
  options: Partial<typeof NO_TOGGLES> = {},
  wholeWord = false,
) => {
  const { regex } = buildFindRegex(query, { ...NO_TOGGLES, ...options });
  expect(regex).not.toBeNull();
  return findRanges(regex!, text, wholeWord).map((r) =>
    text.slice(r.start, r.start + r.length),
  );
};

describe("buildFindRegex", () => {
  it("把普通输入当字面量处理，特殊字符不当作正则语法", () => {
    expect(rangesOf("a.c abc", "a.c")).toEqual(["a.c"]);
  });

  it("非法正则给出可读提示且不产出表达式", () => {
    const built = buildFindRegex("a(", { ...NO_TOGGLES, regex: true });
    expect(built.regex).toBeNull();
    expect(built.error).toBe("正则表达式无效");
  });

  it("空查询不产出表达式（打开查找条但还没输入的常态）", () => {
    expect(buildFindRegex("", NO_TOGGLES).regex).toBeNull();
  });
});

describe("findRanges", () => {
  it("默认不区分大小写，打开开关后只认原样大小写", () => {
    expect(rangesOf("Foo foo FOO", "foo")).toEqual(["Foo", "foo", "FOO"]);
    expect(rangesOf("Foo foo FOO", "foo", { caseSensitive: true })).toEqual([
      "foo",
    ]);
  });

  it("整词只认两侧都不是词字符的命中，中文按同一套判据", () => {
    expect(rangesOf("cat category cat.", "cat", {}, true)).toEqual([
      "cat",
      "cat",
    ]);
    // 中文没有空格分词，判界同样按「两侧都不是 Unicode 词字符」：「查找」被引号
    // 包住算整词，「查找条」里紧跟汉字就不算（与 `\b` 的 ASCII 口径一致——它在
    // 中文上根本不成立，所以这一层不能直接用 `\b`）。
    expect(rangesOf("「查找」的查找条", "查找", {}, true)).toEqual(["查找"]);
  });

  it("正则模式按表达式匹配，零宽命中不会卡死", () => {
    expect(rangesOf("a1 b2", "\\w\\d", { regex: true })).toEqual(["a1", "b2"]);
    // `a*` 在 `bbb` 上全是零宽命中——推进一格继续，返回空而不是死循环。
    expect(rangesOf("bbb", "a*", { regex: true })).toEqual([]);
  });

  it("命中数有上限，正则写宽了不会把一条长消息撑爆", () => {
    const text = "a".repeat(20000);
    expect(rangesOf(text, "a").length).toBe(500);
  });
});

describe("countMessageHits", () => {
  const message = (blocks: Message["blocks"]): Message => ({
    id: "m1",
    role: "assistant",
    blocks,
    timestamp: new Date(0).toISOString(),
  });

  it("覆盖正文、思考、工具名与命令输出", () => {
    const msg = message([
      { type: "reasoning", content: "先看看 webview 的状态" },
      { type: "text", content: "webview 里改一处" },
      {
        type: "tool",
        name: "Bash",
        stage: "end",
        compactParams: "rg webview src",
        result: "src/webview/index.tsx",
      },
    ]);
    const { regex } = buildFindRegex("webview", NO_TOGGLES);
    // 4 处：思考 1、正文 1、命令 1、输出路径 1。
    expect(countMessageHits(msg, regex!)).toBe(4);
  });

  it("图片与文件历史这类没有文本的块不贡献命中", () => {
    const msg = message([
      { type: "image", imageUrls: ["data:image/png;base64,AAAA"] },
      { type: "file_history", snapshots: [] },
    ]);
    const { regex } = buildFindRegex("data", NO_TOGGLES);
    expect(countMessageHits(msg, regex!)).toBe(0);
  });
});

describe("wrapTextRange / clearFindMarks", () => {
  it("命中跨多个文本节点时逐节点包裹，不动周围的标签", () => {
    const host = document.createElement("div");
    host.innerHTML = "<p>foo<strong>ba</strong>r tail</p>";
    // 纯文本是 "foobar tail"，命中 "foobar"（0..6）跨了 <strong> 边界。
    wrapTextRange(host, 0, 6, FIND_HIT_CLASS);
    const marks = host.querySelectorAll(`mark.${FIND_HIT_CLASS}`);
    // 三段文本节点各被切一刀：`foo`、`ba`、`r`。
    expect(marks.length).toBe(3);
    expect([...marks].map((m) => m.textContent).join("")).toBe("foobar");
    // 结构仍在：加粗标签没有被摊平成纯文本。
    expect(host.querySelector("strong")?.textContent).toBe("ba");
    expect(host.textContent).toBe("foobar tail");
  });

  it("清理后文本还原，标签结构不变", () => {
    const host = document.createElement("div");
    host.innerHTML = "<p>hello <em>world</em></p>";
    wrapTextRange(host, 0, 5, FIND_HIT_CLASS);
    expect(host.querySelectorAll("mark").length).toBe(1);
    clearFindMarks(host);
    expect(host.querySelectorAll("mark").length).toBe(0);
    expect(host.innerHTML).toBe("<p>hello <em>world</em></p>");
  });
});
