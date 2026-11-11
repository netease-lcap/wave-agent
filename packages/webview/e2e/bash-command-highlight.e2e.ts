import { test, expect } from "./utils/webviewTestHarness.js";
import { MessageInjector } from "./utils/messageInjector.js";
import type { Message } from "wave-agent-sdk";

/**
 * Bash 工具命令行的语法高亮（spec: ui/message-rendering-system.md「Bash 工具
 * 命令行的语法高亮」场景 1 / 5 / 7）。
 *
 * jsdom 那侧（tests/webview/bashCommandHighlight.test.tsx）只能证明「DOM 里生成了
 * token 元素」——token 有了但调色板没加载、或被 `.bash-command` 的基色压过，屏幕上
 * 仍是单色命令，单测一路绿。这里量真实 Chromium 算出来的颜色：token 必须与命令
 * 基色不同，且与围栏代码块 / 文件面板同一份取色（built_in → #4ec9b0）。
 *
 * ⚠️ 加载的是 dist 产物：`pnpm -F wave-webview build` 之后再跑。
 */

const BUILT_IN_RGB = "rgb(78, 201, 176)"; // #4ec9b0
const VARIABLE_RGB = "rgb(156, 220, 254)"; // #9cdcfe

const COMMAND = "cd /tmp && echo $HOME";

const messages = [
  {
    id: "a_bash_command_highlight",
    role: "assistant",
    blocks: [
      {
        type: "tool",
        name: "Bash",
        parameters: JSON.stringify({ command: COMMAND }),
        compactParams: COMMAND,
        stage: "end",
        success: true,
        result: "done\n",
      },
    ],
  },
] as unknown as Message[];

async function seed(page: import("@playwright/test").Page) {
  const injector = new MessageInjector(page);
  await injector.simulateExtensionMessage("setInitialState", {
    isAuthenticated: true,
    messages: [],
    isStreaming: false,
    sessions: [],
    permissionMode: "default",
  });
  await injector.updateMessages(messages);
  // 已结束的块默认收起，命令正文要点开折叠行才在 DOM 里（spec
  // ui/message-rendering-system.md「Bash 工具块默认收起」）。
  await page.click(".bash-tool-header");
  await page.waitForSelector(".bash-command .hljs-built_in");
}

const readColors = (page: import("@playwright/test").Page) =>
  page.evaluate(() => {
    const read = (sel: string) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (!el) return null;
      return getComputedStyle(el).color;
    };
    const command = document.querySelector(".bash-command") as HTMLElement;
    return {
      host: document.documentElement.dataset.host,
      commandText: command?.textContent ?? null,
      commandBase: read(".bash-command"),
      builtIn: read(".bash-command .hljs-built_in"),
      variable: read(".bash-command .hljs-variable"),
      anchors: command?.querySelectorAll("a").length ?? 0,
    };
  });

test("插件端：命令行按 shell 语法着色，且不链接化", async ({ webviewPage }) => {
  await seed(webviewPage);

  const colors = await readColors(webviewPage);
  console.log("bash 命令行高亮实测：", JSON.stringify(colors, null, 2));

  expect(colors.host, "默认 harness 是插件端（editor 档）").toBe("editor");
  // 命令原文逐字节不变
  expect(colors.commandText).toBe(COMMAND);
  expect(colors.builtIn, "built_in 没有着色（调色板没加载？）").toBe(
    BUILT_IN_RGB,
  );
  expect(colors.variable, "变量没有着色").toBe(VARIABLE_RGB);
  // 反面证据：token 的颜色必须与命令基色不同，否则「有 span 但看着仍是单色」
  expect(colors.builtIn).not.toBe(colors.commandBase);
  // 命令行刻意不链接化（spec 场景 5）
  expect(colors.anchors).toBe(0);
});

test("桌面端：同一份调色板照常生效", async ({ webviewPage }) => {
  await seed(webviewPage);

  // 配色不按宿主分叉，这里只钉住「桌面层没有把它覆盖掉」。
  await webviewPage.evaluate(() => {
    document.documentElement.dataset.host = "desktop";
    document.documentElement.setAttribute("data-theme", "dark");
  });

  const colors = await readColors(webviewPage);
  expect(colors.host).toBe("desktop");
  expect(colors.builtIn).toBe(BUILT_IN_RGB);
  expect(colors.variable).toBe(VARIABLE_RGB);
});
