import fs from "node:fs";
import path from "node:path";
import { expect, test } from "./utils/webviewTestHarness.js";
import { MessageInjector } from "./utils/messageInjector.js";
import type { Page } from "@playwright/test";

/**
 * 页面的状态面在真浏览器里的形态（spec remote-control「状态只在一条流内状态条上播报」）。
 *
 * 这一条只能在真 Chromium 里咬：jsdom 与 shim 的 FakeElement harness 都没有布局，
 * 「有没有盖住顶栏」在那里是不可判定的。所以这里加载的是**真的 shim 源码**（
 * `remote/shim.js`，页面实际发的那一份），让它自己把状态条插进页面，再对几何做断言：
 *
 * - 状态条与顶栏**矩形不相交**（浮层时代两者是重叠的：`position:fixed; top:0`）；
 * - 顶栏每颗按钮的**命中**落在按钮自己身上（`elementFromPoint`），而不只是「看起来
 *   还在」——浮层挡住点击时矩形照样算得出来；
 * - 它出现时页面**不长高**（状态条是流内的一行，从消息区里扣）；
 * - 这条线右侧关闭（×）的**热区是按手指给的**（40×40，spec 场景 10）：样式里写着
 *   40px 不代表摆得下，热区也不能被挤出视口——两件事都只有真浏览器量得出来。
 *
 * shim 在这里走到状态条的方式是最短的那条：没有企业端登录态，而 `about:` 这种地址
 * 上也没有登录页可跳，于是它把原因画在状态条上（`fail()`）。这一段与「连不上」用的
 * 是同一个绘制入口，形态一致。
 */

const SHIM = fs.readFileSync(
  path.join(process.cwd(), "remote", "shim.js"),
  "utf8",
);

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 3,
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
});

/** 让页面长成真远控页的样子：宿主标记 + 一段会话（顶栏与输入区的渲染前提）。 */
async function bootstrap(webviewPage: Page) {
  await webviewPage.evaluate(() => {
    document.documentElement.setAttribute("data-remote-page", "1");
    // harness 的外壳给 #root 钉了 100vh，真远控页没有这一条（index.html 里只有
    // 共用样式的 `flex: 1` + `height: 100%`）。钉着它，#root 的自动最小尺寸会等于
    // 整个视口，页面上多出任何一行都会变成溢出 —— 量到的就是外壳而不是页面。
    (document.getElementById("root") as HTMLElement).style.height = "100%";
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

/** 状态条、顶栏与顶栏按钮的几何，外加命中测试。 */
const geometry = (page: Page) =>
  page.evaluate(() => {
    const rect = (el: Element | null) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        top: Math.round(r.top),
        bottom: Math.round(r.bottom),
        height: Math.round(r.height),
      };
    };
    const header = document.querySelector(".chat-header");
    const buttons = [
      ...document.querySelectorAll(".chat-header .header-button"),
    ];
    return {
      innerHeight: window.innerHeight,
      scrollHeight: document.documentElement.scrollHeight,
      status: rect(document.getElementById("remote-status")),
      header: rect(header),
      // 「看得见」与「点得到」是两件事：浮层盖住时矩形照样在，命中却在浮层上。
      hits: buttons.map((button) => {
        const r = button.getBoundingClientRect();
        const at = document.elementFromPoint(
          r.left + r.width / 2,
          r.top + r.height / 2,
        );
        return {
          inside: !!at && (at === button || button.contains(at)),
        };
      }),
    };
  });

/**
 * 关闭键在手指档的几何与命中。判据本身（`pointer: coarse` / `hover: none`）也一起
 * 量回来：这条用例跑在 `hasTouch` 下，若媒体查询没匹配上，测的就是设计稿密度那一
 * 档，断言会变成一句空话。
 */
const closeTarget = (page: Page) =>
  page.evaluate(() => {
    const close = document.querySelector<HTMLElement>(
      '#remote-status button[aria-label="关闭"]',
    );
    if (!close) return null;
    const r = close.getBoundingClientRect();
    const at = document.elementFromPoint(
      r.left + r.width / 2,
      r.top + r.height / 2,
    );
    return {
      coarse:
        window.matchMedia("(pointer: coarse)").matches ||
        window.matchMedia("(hover: none)").matches,
      width: Math.round(r.width),
      height: Math.round(r.height),
      // 热区再大，被挤出视口或压在别的元素下面，手指也点不到。
      hit: !!at && (at === close || close.contains(at)),
      insideStatus:
        r.top >=
        (document.getElementById("remote-status")?.getBoundingClientRect()
          .top ?? 0),
    };
  });

test("状态条是流内一行：不盖顶栏、按钮仍可点、页面不长高", async ({
  webviewPage,
}) => {
  await bootstrap(webviewPage);

  // 页面自己先没有这一行：状态面只在「有话说」时存在。
  expect(await webviewPage.locator("#remote-status").count()).toBe(0);

  await webviewPage.addScriptTag({ content: SHIM });
  await expect(webviewPage.locator("#remote-status")).toBeVisible();
  expect(
    await webviewPage.locator("#remote-status-text").textContent(),
  ).toContain("请先在企业端登录");

  const shown = await geometry(webviewPage);
  expect(shown.header).not.toBeNull();
  expect(shown.header!.height).toBeGreaterThan(0);
  // 1. 不相交：状态条整条在顶栏之上。
  expect(shown.status!.bottom).toBeLessThanOrEqual(shown.header!.top);
  // 2. 顶栏的每颗按钮都是命中点本身（不是被别的元素盖住）。
  expect(shown.hits.length).toBeGreaterThan(0);
  expect(shown.hits.filter((hit) => !hit.inside)).toEqual([]);
  // 3. 页面没有因此长高：那一行是从消息区里扣掉的。
  expect(shown.scrollHeight).toBeLessThanOrEqual(shown.innerHeight);

  // 4. 关闭（×）在手指档是 40×40 的触控目标（spec 场景 10）：此前是给鼠标定的
  //    32×32，且字号落到了无效 `font` 简写的兜底上。
  const close = await closeTarget(webviewPage);
  expect(close?.coarse).toBe(true);
  expect(close!.width).toBeGreaterThanOrEqual(40);
  expect(close!.height).toBeGreaterThanOrEqual(40);
  expect(close!.hit).toBe(true);
  expect(close!.insideStatus).toBe(true);

  // 5. 关掉之后它从流里消失，顶栏的几何回到原样。
  await webviewPage.locator('#remote-status button[aria-label="关闭"]').click();
  expect(await webviewPage.locator("#remote-status").count()).toBe(0);
  const closed = await geometry(webviewPage);
  expect(closed.header!.top).toBe(0);
  expect(closed.hits.filter((hit) => !hit.inside)).toEqual([]);
  expect(closed.scrollHeight).toBeLessThanOrEqual(closed.innerHeight);
});
