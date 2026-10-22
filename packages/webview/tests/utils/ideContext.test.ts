import { describe, it, expect, afterEach } from "vitest";
import {
  assembleIdeContextBlocks,
  buildIdeContextSuggestions,
  findIdeContextMentions,
  ideContextMarker,
  stripTerminalControlChars,
} from "../../src/utils/ideContext";
import { parseMentions } from "../../src/utils/messageUtils";

// 宿主判据来自 window 上的标识（utils/platform.ts）。用例里显式摆出四种宿主：
// IDE 插件（两者都不设）、桌面端、远控页、以及非浏览器环境。
const setHost = (flags: { desktop?: boolean; remote?: boolean }) => {
  const win = window as unknown as Record<string, unknown>;
  if (flags.desktop) win.waveHostType = "desktop";
  else delete win.waveHostType;
  if (flags.remote) win.waveRemotePage = true;
  else delete win.waveRemotePage;
};

afterEach(() => setHost({}));

describe("IDE 上下文：下拉固定条目", () => {
  it("IDE 宿主里给出两条固定条目，排在文件建议之前由调用方拼接", () => {
    setHost({});
    const items = buildIdeContextSuggestions("");
    expect(items.map((item) => item.ideContext)).toEqual([
      "terminal",
      "problems",
    ]);
    expect(items[0].path).toBe("ide:terminal");
  });

  it("按已输入的过滤文本本地筛选（中文标签与英文 id 都能命中）", () => {
    setHost({});
    expect(
      buildIdeContextSuggestions("终").map((item) => item.ideContext),
    ).toEqual(["terminal"]);
    expect(
      buildIdeContextSuggestions("prob").map((item) => item.ideContext),
    ).toEqual(["problems"]);
    expect(buildIdeContextSuggestions("zzz")).toEqual([]);
  });

  it("桌面端与远控页不出现（没有 IDE 可读）", () => {
    setHost({ desktop: true });
    expect(buildIdeContextSuggestions("")).toEqual([]);
    setHost({ remote: true });
    expect(buildIdeContextSuggestions("")).toEqual([]);
  });
});

describe("IDE 上下文：正文标记", () => {
  it("按出现顺序去重取出类别", () => {
    const markdown = [
      ideContextMarker("terminal"),
      "中间的文字",
      ideContextMarker("problems"),
      ideContextMarker("terminal"),
    ].join("\n");
    expect(findIdeContextMentions(markdown)).toEqual(["terminal", "problems"]);
    expect(findIdeContextMentions("没有标记")).toEqual([]);
  });

  it("清理 ANSI 颜色、OSC 标题与进度条重绘", () => {
    const raw = "\u001B[32m✓ success\u001B[0m\r\n进度 10%\r进度 100%\n";
    expect(stripTerminalControlChars(raw)).toBe("✓ success\n进度 100%\n");
  });
});

describe("IDE 上下文：发送时组装", () => {
  it("终端输出展开成「标记 + 标题 + 内容 + 结束标记」，且不再留裸标记", () => {
    const markdown = `看一下这个\n${ideContextMarker("terminal")}`;
    const assembled = assembleIdeContextBlocks(markdown, [
      {
        provider: "terminal",
        ok: true,
        terminalText: "$ npm run build\n出错了",
      },
    ]);

    expect(assembled).toContain("终端输出");
    expect(assembled).toContain("$ npm run build\n出错了");
    expect(assembled).not.toContain("[/@ide]\n[/@ide]");

    // 组装结果必须能被 parseMentions 切回一个 ide-context 片段（用户气泡里
    // 渲染成标签、点开看全文），而正文文字仍是正文。
    const parts = parseMentions(assembled);
    const block = parts.find((part) => part.type === "ide-context");
    expect(block?.ideContext).toBe("terminal");
    expect(block?.content).toContain("$ npm run build");
    expect(parts[0]).toMatchObject({ type: "text" });
  });

  it("同一类别附加两次只取一份内容，两处标记都被替换", () => {
    const markdown = `${ideContextMarker("terminal")} 和 ${ideContextMarker(
      "terminal",
    )}`;
    const assembled = assembleIdeContextBlocks(markdown, [
      { provider: "terminal", ok: true, terminalText: "only-once" },
    ]);
    expect(assembled.match(/only-once/g)).toHaveLength(2);
    // 两处裸标记都换成了成对的块（标记 + 内容 + 结束标记）
    expect(assembled.match(/\[\/@ide\]/g)).toHaveLength(2);
  });

  it("问题按行号排序、带严重级与来源，超过上限时在首行说明", () => {
    const problems = Array.from({ length: 60 }, (_, index) => ({
      line: 60 - index,
      column: 1,
      severity: (index % 2 === 0 ? "error" : "warning") as "error" | "warning",
      message: `问题 ${60 - index}`,
      source: "tsc",
    }));
    const assembled = assembleIdeContextBlocks(ideContextMarker("problems"), [
      { provider: "problems", ok: true, problems, filePath: "src/a.ts" },
    ]);

    expect(assembled).toContain("src/a.ts");
    expect(assembled).toContain(
      "共 60 条：30 个错误 / 30 个警告，仅列前 50 条",
    );
    // 行号 1 那条是 warning（构造时按 index 奇偶交替）
    expect(assembled).toContain("  1:1  warning  问题 1 (tsc)");
    expect(assembled.indexOf("1:1")).toBeLessThan(assembled.indexOf("2:1"));
    // 第 51 条之后不再列出（按行号序取前 50 条）。
    expect(assembled).not.toContain("问题 51");
  });

  it("宿主读不到时写一行不可用说明，消息照常组装", () => {
    const assembled = assembleIdeContextBlocks(
      `${ideContextMarker("terminal")}\n${ideContextMarker("problems")}`,
      [
        { provider: "terminal", ok: false, reason: "没有活动终端" },
        { provider: "problems", ok: true, problems: [], filePath: "a.ts" },
      ],
    );
    expect(assembled).toContain("终端输出不可用：没有活动终端");
    expect(assembled).toContain("共 0 条：0 个错误 / 0 个警告");
  });

  it("宿主没返回某个类别时也按不可用处理，不丢标记", () => {
    const assembled = assembleIdeContextBlocks(
      ideContextMarker("problems"),
      [],
    );
    expect(assembled).toContain("当前文件的问题不可用");
    expect(assembled).toContain("[/@ide]");
  });

  it("没有标记的正文原样返回", () => {
    expect(assembleIdeContextBlocks("普通消息", [])).toBe("普通消息");
  });
});
