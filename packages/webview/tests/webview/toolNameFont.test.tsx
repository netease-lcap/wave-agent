/**
 * 对话流里的工具名字号同档（specs/ui/message-rendering-system.md「消息历史显示」
 * 场景里的「工具名字号同档」）。
 *
 * 用户 2026-11-11 截图反馈：「为啥我发现 Bash 工具名称的字体要比 Read 和 Write
 * 要小」。根因在桌面层：`host-desktop.css` 的「① 对话流工具名」只统一了字重
 * （600），字号漏了 —— `.write-tool-label` 与 `.reasoning-title` 各自有 14px 覆写，
 * 而所有通用工具行（Bash / Glob / Grep / Agent / mcp__* …）走的 `.tool-block`
 * 停在 base 的 13px。插件端三处都是 base 13px，本来就没有这个问题。
 *
 * 这里的断言是「同一类型的标题必须同字号」：不是钉某个具体 px，而是钉住
 * 「通用工具行 = 文件工具头 = 思考标题」三者取同一个值，且桌面端比插件端大一档。
 *
 * 迁移自 `e2e/tool-name-font.e2e.ts`：那边原来写「要真 Chrome 算字体大小」，
 * 而本套件本来就跑在真 Chromium 里（`getComputedStyle` 是浏览器自己算的），
 * 所以并回来，宿主档位仍靠 `data-host` 切换（真桌面端由 index.html 静态声明）。
 */

import { describe, it, expect, afterEach } from "vitest";
import { renderChatApp, sendCommand } from "./test-utils";
// 桌面档的 14px 就来自这份样式；它所有选择器都带 `[data-host="desktop"]`。
import "../../src/styles/host-desktop.css";

function toolBlock(
  name: string,
  parameters: Record<string, unknown>,
  result: string,
) {
  return {
    type: "tool",
    name,
    parameters: JSON.stringify(parameters),
    compactParams: String(parameters.description ?? parameters.pattern ?? ""),
    stage: "end",
    success: true,
    result,
  };
}

const message = {
  id: "tool-name-font",
  role: "assistant",
  timestamp: "2026-01-01T00:00:00.000Z",
  blocks: [
    {
      type: "reasoning",
      content: "先看目录再决定读哪个文件。",
      stage: "end",
      startTime: 1_000,
      endTime: 3_000,
    },
    toolBlock("Bash", { command: "ls", description: "列出目录" }, "a.txt"),
    toolBlock("Glob", { pattern: "**/*.ts" }, "3 files"),
    toolBlock("Read", { file_path: "/tmp/a.ts" }, "1 line"),
    toolBlock("Write", { file_path: "/tmp/b.ts", content: "x" }, "Wrote 1"),
    toolBlock(
      "Edit",
      { file_path: "/tmp/c.ts", old_string: "a", new_string: "b" },
      "Updated",
    ),
    toolBlock("Agent", { description: "查资料", prompt: "…" }, "done"),
    toolBlock("mcp__nebula__search_docs", { query: "x" }, "results"),
    toolBlock("WebFetch", { url: "https://example.com" }, "fetched"),
  ],
};

async function renderWithTools() {
  renderChatApp();
  sendCommand("updateMessages", { messages: [message] });
}

function measure() {
  const collect = (selector: string) =>
    Array.from(document.querySelectorAll(selector)).map(
      (el) => getComputedStyle(el as HTMLElement).fontSize,
    );
  return {
    toolBlocks: collect(".tool-block"),
    fileToolNames: collect(".write-tool-label"),
    reasoningTitles: collect(".reasoning-title"),
  };
}

const unique = (values: string[]) => Array.from(new Set(values));

afterEach(() => {
  delete document.documentElement.dataset.host;
  document.documentElement.removeAttribute("data-theme");
});

describe("工具名字号同档", () => {
  it("插件端：通用工具行 / 文件工具头 / 思考标题都是同一档 13px", async () => {
    await renderWithTools();
    const sizes = measure();

    // 样本齐了才谈得上「同档」
    expect(sizes.toolBlocks.length).toBeGreaterThanOrEqual(5);
    expect(sizes.fileToolNames.length).toBe(3); // Read / Write / Edit
    expect(sizes.reasoningTitles.length).toBe(1);

    for (const group of [
      sizes.toolBlocks,
      sizes.fileToolNames,
      sizes.reasoningTitles,
    ]) {
      expect(unique(group)).toEqual(["13px"]);
    }
  });

  it("桌面端：三者一起抬到 14px，通用工具行不得落在 13px", async () => {
    await renderWithTools();

    // `index.tsx` 用同一个 dataset 属性切桌面层（真桌面端由 index.html 静态声明）
    document.documentElement.dataset.host = "desktop";

    const sizes = measure();

    expect(sizes.toolBlocks.length).toBeGreaterThanOrEqual(5);
    expect(sizes.fileToolNames.length).toBe(3);
    expect(sizes.reasoningTitles.length).toBe(1);

    for (const group of [
      sizes.toolBlocks,
      sizes.fileToolNames,
      sizes.reasoningTitles,
    ]) {
      expect(unique(group)).toEqual(["14px"]);
    }
  });
});
