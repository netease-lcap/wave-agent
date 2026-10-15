import { expect, test } from "./utils/webviewTestHarness.js";
import { MessageInjector } from "./utils/messageInjector.js";
import type { Page } from "@playwright/test";

/**
 * 远控页的文本控件字号下限（spec remote-control「Web 页作为第五种宿主」场景 15）
 * 在真实浏览器里的那一半。iOS 的 autozoom 本身无头浏览器没有，但它的**开关**是可
 * 测的：控件算出来 < 16px ⇒ 真机上聚焦即整页放大。所以这里量的是浏览器级联出来的
 * 值，而不是样式表里写了什么 —— 单测（tests/remote/remotePageZoomGuard.test.ts）
 * 只能读文本，而这次的失效正好发生在文本看不太出来的地方。
 *
 * 2026-10-15 真机回归：右上角「会话」/「历史对话」按钮的弹窗挂载即自动聚焦搜索框，
 * 而 `.session-list-search`（组件基线 12px）被手机档收进了次级信息组 = 14px。档位组
 * 的选择器是「属性 + 类」(0,2,0)，下限是「属性 + 元素」(0,1,1)：档位组比特异性赢，
 * 下限写在后面也没用 ⇒ 下限必须 `!important`。
 *
 * ⚠️ 加载的是 dist 产物 CSS：改过样式先跑 `pnpm -F wave-webview build`。
 */

// 手机档（`pointer: coarse` / `hover: none`）只在触控设备上生效，而这一页是五端里
// 唯一「一种宿主对应两种设备」的页面 —— 必须用触控 context 才走得到档位组，也就才
// 复现得出这个 bug。桌面 context 下档位组不参与级联，量出来永远是 16px（假绿）。
test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 3,
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
});

/** shim 打在 <html> 上的标记 + 一个已登录的空会话（弹窗与顶栏的渲染前提）。 */
async function bootstrap(webviewPage: Page) {
  await webviewPage.evaluate(() => {
    document.documentElement.setAttribute("data-remote-page", "1");
  });
  const injector = new MessageInjector(webviewPage);
  await injector.simulateExtensionMessage("setInitialState", {
    isAuthenticated: true,
    messages: [],
    isStreaming: false,
    sessions: [],
    permissionMode: "default",
  });
}

/** 页面上每个文本类控件的 computed 字号（跳过 checkbox 这类不触发放大的控件）。 */
const controlSizes = (page: Page) =>
  page.evaluate(() => {
    const nonText = new Set([
      "hidden",
      "checkbox",
      "radio",
      "file",
      "range",
      "color",
      "button",
      "submit",
      "reset",
      "image",
    ]);
    const isTextControl = (el: Element) => {
      const tag = el.tagName.toLowerCase();
      if (tag === "textarea" || tag === "select") return true;
      if (tag === "input")
        return !nonText.has((el.getAttribute("type") || "text").toLowerCase());
      return el.hasAttribute("contenteditable");
    };
    return [
      ...document.querySelectorAll(
        "input, textarea, select, [contenteditable]",
      ),
    ]
      .filter(isTextControl)
      .map((el) => ({
        what: `${el.tagName.toLowerCase()}${
          el.className ? `.${String(el.className).split(" ")[0]}` : ""
        }`,
        size: parseFloat(getComputedStyle(el).fontSize),
        focused: el === document.activeElement,
      }));
  });

test("远控页手机档：会话弹窗一打开，自动聚焦的搜索框就在 16px 线上", async ({
  webviewPage,
}) => {
  await bootstrap(webviewPage);

  // 顶栏的列表入口（IDE 分支是「历史对话」，远控页把同一个 popup 挂在「会话」
  // 按钮上——两边都是这一个组件、这一份类名）。
  await webviewPage.click('[data-testid="history-btn"]');
  const search = webviewPage.locator(".session-list-search");
  await expect(search).toBeVisible();

  const measured = await controlSizes(webviewPage);
  const box = measured.find((c) =>
    c.what.startsWith("input.session-list-search"),
  );
  expect(box, "会话弹窗的搜索框没渲染出来").toBeDefined();
  // 自动聚焦是放大发生的那一步：真机报的就是「点了按钮，还没打字，页面就放大了」。
  expect(box!.focused, "弹窗挂载应当自动聚焦搜索框（放大的触发点）").toBe(true);
  expect(box!.size).toBeGreaterThanOrEqual(16);
});

test("远控页手机档：弹窗打开时页面上每个文本控件都在 16px 线上", async ({
  webviewPage,
}) => {
  await bootstrap(webviewPage);

  // 历史搜索弹窗（Ctrl+R，按在输入区上）是另一条自动聚焦的路径，同样是 12px
  // 基线的输入框。
  await webviewPage.click('[data-testid="message-input"]');
  await webviewPage.keyboard.press("Control+r");
  await expect(webviewPage.locator(".history-search-input")).toBeVisible();

  const belowLine = (await controlSizes(webviewPage)).filter(
    (c) => c.size < 16,
  );
  expect(
    belowLine,
    `这些控件低于 16px ⇒ iOS 一聚焦就整页放大：${belowLine
      .map((c) => `${c.what}=${c.size}px`)
      .join(", ")}`,
  ).toEqual([]);
});
