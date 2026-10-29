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
 * 场景 27（图标按钮的触控档）那几族也在这里量：热区、间距、字形三者必须同时成立，
 * 而这几件事只有真浏览器算得出来（jsdom 不解析样式表）。2026-10-29 补的第四族是
 * 消息队列每条右边的编辑 / 立即发送 / 删除。
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
// 复现得出这个 bug（档位组把某个控件的类名收进去 ⇒ 压过下限）。桌面 context 走的是
// 另一半：档位组与下限都不生效，页面上只该剩组件自己的基线（下面那组用例）。
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

/**
 * 消息队列的行内动作（编辑 / 立即发送 / 删除）—— 场景 27 第四族。
 *
 * 这一族除了尺寸，还有一处**尺寸之外**的问题：桌面档靠 `.queued-item:hover` 才把
 * 按钮组显形（`opacity: 0`），触控设备没有悬停。所以两边量的不只是「多大」，还有
 * 「看不看得见」——手机档常显、PC 档仍靠 hover。
 */
async function openQueue(webviewPage: Page) {
  const injector = new MessageInjector(webviewPage);
  await injector.updateQueue([
    { id: "q1", content: "顺便帮乐观锁中间件补一组单元测试，覆盖并发写入场景" },
    { id: "q2", content: "把这段逻辑抽成独立模块" },
  ]);
  await webviewPage.locator(".queued-message-list-header").click();
  await expect(webviewPage.getByTestId("queued-item-q1")).toBeVisible();
  // 点 header 之后光标停在面板上 —— 那会让 `.queued-item:hover` 生效，量出来的
  // 「按钮组可见」是 hover 给的、不是手机档给的。先把指针移出面板，再量尺寸。
  await webviewPage.mouse.move(0, 0);
}

const queueGeometry = (page: Page) =>
  page.evaluate(() => {
    const box = (sel: string) => {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    };
    const gap = (sel: string, axis: "row" | "column") =>
      parseFloat(getComputedStyle(document.querySelector(sel)!)[`${axis}Gap`]);
    const opacity = (sel: string) =>
      parseFloat(getComputedStyle(document.querySelector(sel)!).opacity);
    return {
      edit: box('[data-testid="queued-edit-q1"]'),
      send: box('[data-testid="queued-send-q1"]'),
      remove: box('[data-testid="queued-delete-q1"]'),
      glyph: box('[data-testid="queued-send-q1"] svg'),
      actionsGap: gap(".queued-item-actions", "column"),
      // 跨行也是「相邻两个按钮」：行间距同样要 ≥8px。
      rowGap: gap(".queued-items", "row"),
      actionsOpacity: opacity(".queued-item-actions"),
      item: box(".queued-item"),
      header: box(".queued-message-list-header"),
    };
  });

test("远控页手机档：消息队列的行内动作按手指给足（场景 27 第四族）", async ({
  webviewPage,
}) => {
  await bootstrap(webviewPage);
  await openQueue(webviewPage);

  const geom = await queueGeometry(webviewPage);

  // 三枚按钮各 40×40、字形 20、彼此间距 8（热区与间距必须同时给足）。
  expect(geom.edit).toEqual({ w: 40, h: 40 });
  expect(geom.send).toEqual({ w: 40, h: 40 });
  expect(geom.remove).toEqual({ w: 40, h: 40 });
  expect(geom.glyph).toEqual({ w: 20, h: 20 });
  expect(geom.actionsGap).toBe(8);
  // 跨行的两枚按钮同样隔 8px（行间距也是「相邻按钮之间的间距」）。
  expect(geom.rowGap).toBe(8);
  // 让位：行轨道从 24 抬到 40 —— 行高即按钮高，多一圈上下内衬就是白给的空隙
  // （用户 2026-10-29 报「上下空隙特别大」）。按钮不越出所在行。
  expect(geom.item!.h).toBe(40);
  // 折叠标题行（整行可点）同档。
  expect(geom.header!.h).toBe(40);
  // 触控设备没有悬停 ⇒ 按钮组常显，否则 40×40 也没机会被按到。
  expect(geom.actionsOpacity).toBe(1);
  // 整屏约束（场景 14）仍成立：队列把每条抬高之后，页面本身不出现纵向滚动。
  const page = await webviewPage.evaluate(() => ({
    scroll: document.documentElement.scrollHeight,
    viewport: document.documentElement.clientHeight,
  }));
  expect(page.scroll).toBe(page.viewport);
});

/**
 * 另一半：鼠标 context。同一个判据不成立 ⇒ 16px 下限与手机档一起失效，页面上只该
 * 剩组件自己的基线（设计稿密度）。2026-10-16 之前下限写在媒体查询之外、不判设备，
 * PC 上每个输入框都是 16px，而同屏正文只有 13px —— 他打开页面时报「所有输入控件
 * 都是 16px，看着有点大」。下面两条就是那次的守卫：把下限搬出媒体查询，两条都红。
 */
test.describe("远控页 PC 档（鼠标 context）", () => {
  test.use({
    viewport: { width: 1280, height: 900 },
    hasTouch: false,
    isMobile: false,
    deviceScaleFactor: 1,
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  });

  test("PC 档：文本控件回到组件自己的基线，不再被抬到 16px", async ({
    webviewPage,
  }) => {
    await bootstrap(webviewPage);

    await webviewPage.click('[data-testid="history-btn"]');
    const search = webviewPage.locator(".session-list-search");
    await expect(search).toBeVisible();

    const box = (await controlSizes(webviewPage)).find((c) =>
      c.what.startsWith("input.session-list-search"),
    );
    expect(box, "会话弹窗的搜索框没渲染出来").toBeDefined();
    expect(
      box!.size,
      `PC 上不该出现 16px 下限（量到 ${box!.size}px）`,
    ).toBeLessThan(16);
  });

  test("PC 档：消息队列的行内动作保持设计稿尺寸，且仍靠 hover 显形", async ({
    webviewPage,
  }) => {
    await bootstrap(webviewPage);
    await openQueue(webviewPage);

    const geom = await queueGeometry(webviewPage);

    // 鼠标指针档：18×18（padding 2 + 字形 14）、间距 2 —— 手机档没漏过来。
    expect(geom.edit).toEqual({ w: 18, h: 18 });
    expect(geom.send).toEqual({ w: 18, h: 18 });
    expect(geom.remove).toEqual({ w: 18, h: 18 });
    expect(geom.glyph).toEqual({ w: 14, h: 14 });
    expect(geom.actionsGap).toBe(2);
    expect(geom.rowGap).toBe(4);
    expect(geom.item!.h).toBe(24);
    expect(geom.header!.h).toBe(24);
    expect(geom.actionsOpacity).toBe(0);
  });

  test("PC 档：正文保持设计稿密度（手机档同样不生效）", async ({
    webviewPage,
  }) => {
    await bootstrap(webviewPage);

    const bodySize = await webviewPage.evaluate(() =>
      parseFloat(getComputedStyle(document.body).fontSize),
    );
    expect(
      bodySize,
      `PC 档正文不该被抬到手机档（量到 ${bodySize}px）`,
    ).toBeLessThan(15);
  });
});
