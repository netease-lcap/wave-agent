import { test, expect } from "./utils/webviewTestHarness.js";
import { MessageInjector } from "./utils/messageInjector.js";
import type { Message } from "wave-agent-sdk";

/**
 * 助手消息围栏代码块的语法高亮（spec: ui/message-rendering-system.md「助手消息
 * 代码块的语法高亮」场景 1 / 2 / 7）。
 *
 * jsdom 那侧（tests/webview/codeBlockHighlight.test.tsx）只能证明「DOM 里生成了
 * token 元素」——token 元素有了但调色板没加载、或被 `.markdown-content code` 的
 * 基色压过，屏幕上仍是单色代码，单测一路绿。这里量的是真实 Chromium 算出来的
 * 颜色：token 必须与代码基色不同，且与文件面板同一份取色（#569cd6 / #ce9178）。
 *
 * ⚠️ 加载的是 dist 产物：`pnpm -F wave-webview build` 之后再跑。
 */

const KEYWORD_RGB = "rgb(86, 156, 214)"; // #569cd6
const STRING_RGB = "rgb(206, 145, 120)"; // #ce9178

const messages = [
  {
    id: "a_highlight",
    role: "assistant",
    blocks: [
      {
        type: "text",
        content:
          "示例：\n\n```ts\nconst answer: string = \"你好\";\n```\n\n认不出的语言：\n\n```lua\nprint('hi')\n```",
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
  await page.waitForSelector(".markdown-content pre code");
}

const readColors = (page: import("@playwright/test").Page) =>
  page.evaluate(() => {
    const read = (sel: string) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (!el) return null;
      return getComputedStyle(el).color;
    };
    const codes = Array.from(
      document.querySelectorAll(".markdown-content pre code"),
    ) as HTMLElement[];
    return {
      host: document.documentElement.dataset.host,
      codeBase: read(".markdown-content pre code"),
      keyword: read(".markdown-content pre code .hljs-keyword"),
      string: read(".markdown-content pre code .hljs-string"),
      unknownLangClass: codes[1]?.className ?? null,
      unknownLangTokens: codes[1]?.querySelectorAll("span").length ?? 0,
    };
  });

test("插件端：代码块按语言着色，未知语言保持纯文本", async ({
  webviewPage,
}) => {
  await seed(webviewPage);

  const colors = await readColors(webviewPage);
  console.log("代码块高亮实测：", JSON.stringify(colors, null, 2));

  expect(colors.host, "默认 harness 是插件端（editor 档）").toBe("editor");
  expect(colors.keyword, "关键字没有着色（调色板没加载？）").toBe(KEYWORD_RGB);
  expect(colors.string, "字符串没有着色").toBe(STRING_RGB);
  // 反面证据：token 的颜色必须与代码基色不同，否则「有 span 但看着仍是单色」。
  expect(colors.keyword).not.toBe(colors.codeBase);

  // 未注册语言：class 保留围栏里写的那一个，但不产生 token。
  expect(colors.unknownLangClass).toContain("language-lua");
  expect(colors.unknownLangTokens).toBe(0);
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
  expect(colors.keyword).toBe(KEYWORD_RGB);
  expect(colors.string).toBe(STRING_RGB);
});
