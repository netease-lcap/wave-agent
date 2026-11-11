import { test, expect } from "./utils/webviewTestHarness.js";
import { MessageInjector } from "./utils/messageInjector.js";
import type { Message } from "wave-agent-sdk";

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
 * ⚠️ 加载的是 dist 产物：`node esbuild.config.mjs` 之后再跑。
 */

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

function message(): Message {
  return {
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
  } as unknown as Message;
}

type FontSizes = {
  toolBlocks: string[];
  fileToolNames: string[];
  reasoningTitles: string[];
};

async function measure(page: import("@playwright/test").Page) {
  return page.evaluate<FontSizes>(() => {
    const collect = (selector: string) =>
      Array.from(document.querySelectorAll(selector)).map(
        (el) => getComputedStyle(el as HTMLElement).fontSize,
      );
    return {
      toolBlocks: collect(".tool-block"),
      fileToolNames: collect(".write-tool-label"),
      reasoningTitles: collect(".reasoning-title"),
    };
  });
}

function unique(values: string[]) {
  return Array.from(new Set(values));
}

test.describe("工具名字号同档", () => {
  test.beforeEach(async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    await injector.simulateExtensionMessage("setInitialState", {
      isAuthenticated: true,
      messages: [],
      isStreaming: false,
      sessions: [],
      permissionMode: "default",
    });
    await injector.updateMessages([message()]);
    await webviewPage.waitForSelector(".tool-block");
    await webviewPage.waitForSelector(".write-tool-label");
  });

  test("插件端：通用工具行 / 文件工具头 / 思考标题都是同一档 13px", async ({
    webviewPage,
  }) => {
    const sizes = await measure(webviewPage);

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

  test("桌面端：三者一起抬到 14px，通用工具行不得落在 13px", async ({
    webviewPage,
  }) => {
    // `index.tsx` 用同一个 dataset 属性切桌面层（真桌面端由 index.html 静态声明）
    await webviewPage.evaluate(() => {
      document.documentElement.dataset.host = "desktop";
    });

    const sizes = await measure(webviewPage);

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
