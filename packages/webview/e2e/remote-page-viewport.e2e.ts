import fs from "node:fs";
import path from "node:path";
import { test, expect } from "./utils/webviewTestHarness.js";
import { MessageInjector } from "./utils/messageInjector.js";
import { Message } from "wave-agent-sdk";

/**
 * The remote Web page's viewport rules (spec remote-control「Web 页作为第五种宿主」
 * 场景 13) — real-browser only, in both directions:
 *
 * - The page must fit the phone screen in ONE screen: header and input area both
 *   visible, no page-level scrolling. This is what a static `100vh` breaks on iOS
 *   Safari (it resolves to the large viewport — the height with the browser
 *   toolbars retracted — so the bottom-anchored input area lands below the fold),
 *   and why the height is declared in `dvh`.
 * - The safe-area insets must come OUT of that height, not add to it: the page
 *   opts into `viewport-fit=cover`, so the system UI (status bar, Home indicator)
 *   overlaps its edges.
 *
 * ⚠️ What this file can and cannot see. A headless browser has neither a
 * collapsing toolbar (so `dvh` and `vh` are the same number here) nor safe-area
 * insets (so `env()` resolves to its fallback): those two *behaviours* need a real
 * iPhone to confirm. What is asserted here is the wiring the phone depends on —
 * the declarations are in the shipped stylesheet (read as text: `vh` winning back
 * over `dvh` is invisible in this browser but reproduces the original bug), and
 * the inset padding keeps the page exactly one screen tall instead of growing it
 * (the failure mode a dropped `box-sizing` reintroduces).
 */

const build = (count: number): Message[] =>
  Array.from(
    { length: count },
    (_, i) =>
      ({
        id: `m${i}`,
        role: i % 2 === 0 ? "user" : "assistant",
        timestamp: new Date(Date.UTC(2026, 0, 1) + i * 60000).toISOString(),
        blocks: [
          { type: "text", content: `第 ${i} 条：撑满一屏的中文消息内容。` },
        ],
      }) as unknown as Message,
  );

const geometry = async (page: import("@playwright/test").Page) =>
  page.evaluate(() => {
    const de = document.documentElement;
    const box = (selector: string) => {
      const el = document.querySelector(selector) as HTMLElement | null;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        top: Math.round(r.top),
        bottom: Math.round(r.bottom),
        height: Math.round(r.height),
      };
    };
    return {
      innerHeight: window.innerHeight,
      scrollHeight: de.scrollHeight,
      header: box(".chat-header"),
      inputArea: box(".input-area-container"),
      // 输入区可见 ⇔ 用户能发消息，这就是这一条规格要求的落点。
      paddingTop: getComputedStyle(document.body).paddingTop,
      paddingBottom: getComputedStyle(document.body).paddingBottom,
      boxSizing: getComputedStyle(document.body).boxSizing,
    };
  });

test("远控页：顶栏与输入区同屏、页面不滚动、安全区从高度里扣", async ({
  webviewPage,
}) => {
  // 1. 产物里的两条声明（浏览器里 vh 与 dvh 同值，只能读文本）。dist 是 e2e
  //    harness 实际加载的那份 CSS。
  const css = fs.readFileSync(
    path.join(process.cwd(), "dist", "chat.css"),
    "utf-8",
  );
  expect(
    /body\s*\{[^}]*height:\s*100vh;[^}]*height:\s*100dvh;/.test(css),
    "body 的高度必须以 dvh 收尾（vh 在前作回落）；先跑 pnpm -F wave-webview build",
  ).toBe(true);
  expect(
    /\[data-remote-page\]\s*body\s*\{[^}]*box-sizing:\s*border-box;[^}]*padding-top:\s*env\(\s*safe-area-inset-top/.test(
      css,
    ),
    "安全区让位规则必须与 border-box 同在一处；先跑 pnpm -F wave-webview build",
  ).toBe(true);

  await webviewPage.setViewportSize({ width: 390, height: 664 });
  const injector = new MessageInjector(webviewPage);
  await injector.simulateExtensionMessage("setInitialState", {
    isAuthenticated: true,
    messages: [],
    isStreaming: false,
    sessions: [],
    permissionMode: "default",
  });
  await injector.updateMessages(build(12));

  // 2. 没有宿主标记时（IDE / 桌面四端）安全区规则不生效：页面永远不会自带内边距。
  const withoutMark = await geometry(webviewPage);
  expect(withoutMark.paddingTop).toBe("0px");
  expect(withoutMark.paddingBottom).toBe("0px");
  expect(withoutMark.inputArea!.bottom).toBeLessThanOrEqual(
    withoutMark.innerHeight,
  );

  // 3. 打上 shim 的标记（远控页的形态）：仍要整屏装得下。
  await webviewPage.evaluate(() => {
    document.documentElement.setAttribute("data-remote-page", "1");
  });
  const marked = await geometry(webviewPage);
  expect(marked.boxSizing).toBe("border-box");
  expect(marked.header!.top).toBe(0);
  expect(marked.inputArea!.bottom).toBeLessThanOrEqual(marked.innerHeight);
  expect(marked.scrollHeight).toBe(marked.innerHeight);

  // 4. 让位是「从可视高度里扣」而不是「加在高度之外」：注入 iPhone 独立窗口的
  //    安全区取值（顶 47 / 底 34），只覆盖 padding、不动产物里那条 box-sizing
  //    —— 产物里那条一旦被摘掉，这里立刻变成整页滚动。
  //
  //    先按真页面的形状修掉测试外壳的一处差异：harness 的 <style> 给 #root 钉了
  //    `height: 100vh`，而真远控页的 index.html 里没有这条（#root 只有共用样式的
  //    `flex: 1` + `height: 100%`）。那条规则会被当成 flex 项的「指定尺寸建议」，
  //    把自动最小尺寸抬到大视口高度 ⇒ 内容不再收缩、让位内边距就变成溢出——
  //    量到的是外壳的行为而不是页面的行为。
  await webviewPage.evaluate(() => {
    (document.getElementById("root") as HTMLElement).style.height = "100%";
  });
  await webviewPage.addStyleTag({
    content: `[data-remote-page] body {
      padding-top: 47px;
      padding-bottom: 34px;
    }`,
  });
  const insets = await geometry(webviewPage);
  expect(insets.paddingTop).toBe("47px");
  expect(insets.paddingBottom).toBe("34px");
  expect(insets.boxSizing).toBe("border-box");
  expect(insets.header!.top).toBe(47);
  expect(insets.inputArea!.bottom).toBe(insets.innerHeight - 34);
  expect(insets.scrollHeight).toBe(insets.innerHeight);
});
