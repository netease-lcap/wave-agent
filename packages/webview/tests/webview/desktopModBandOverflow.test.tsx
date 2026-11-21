/**
 * 桌面端输入卡周围三样 mod 输出的**高度上限**（spec
 * `ecosystem/plugin-mods.md`「状态带、状态行与提示」）。
 *
 * 迁移自 `e2e/desktop-mod-band-overflow.e2e.ts`。高度上限只能在这里测：jsdom 没有
 * 布局。历史缺陷 —— 带、状态行、提示都没有上限，60 行的带把输入卡顶到 y=1342
 * （1180×760 视口里完全看不见），1 万字符的状态行 1072px、6 条长提示 1022px，
 * 三种都把消息区压成 h=0。
 *
 * 三样都吃限额内的极值，输入卡必须还在视口里。宿主档由 `desktopHarness` 打开
 * （`data-host="desktop"` + host-desktop.css），viewport 用真机 e2e 的原尺寸。
 */

import { describe, it, expect, afterEach } from "vitest";
import { page } from "vitest/browser";
import { MockDataGenerator } from "../fixtures/mockData";
import { sendCommand } from "./test-utils";
import {
  bootDesktop,
  isVisible,
  renderDesktopApp,
  resetHostTier,
  resetPanelState,
} from "./desktopHarness";

const DIR = "/Users/dev/projects/wave-agent";

/** 60 行：远不到 2000 节点的限额，但已经比输入区高得多。 */
const tallTree = {
  type: "Box",
  props: { flexDirection: "column", gap: "xs" },
  children: Array.from({ length: 60 }, (_, i) => ({
    type: "Text",
    props: {},
    children: [`待办 ${i + 1}：跑一遍桌面端真机截图`],
  })),
};

/** `$.ui.status` / `$.ui.toast` 的字符限额就是 10 000。 */
const LONG_TEXT = "监听 .wave/todos.json ·".repeat(400);

/** 一个待办量对应的状态行文本，够长但不至于把一行撑满。 */
const statusText = (i: number) => `待办 ${i + 1} 项 · 监听 .wave/todos.json`;

afterEach(() => {
  resetHostTier();
  resetPanelState();
});

/** 起一个桌面分屏，并推一条对话（输入卡要「有内容」才不是欢迎页那套居中）。 */
function setup() {
  renderDesktopApp();
  bootDesktop({ workdir: DIR });
  sendCommand("updateMessages", {
    messages: [
      MockDataGenerator.createUserMessage("把 todo 列表放到输入框上面"),
      MockDataGenerator.createAssistantMessage("好的。"),
    ],
  });
}

/** 尺寸 + 是否真的内部可滚（`scrollHeight > clientHeight`）/ 被省略号截断。 */
const metrics = (selector: string) => {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {
    h: Math.round(r.height),
    y: Math.round(r.y),
    x: Math.round(r.x),
    w: Math.round(r.width),
    clientH: el.clientHeight,
    scrollH: el.scrollHeight,
    clientW: el.clientWidth,
    scrollW: el.scrollWidth,
  };
};

/** 输入卡整个落在视口里（对齐 Playwright 的 `boundingBox()` + viewport 比较）。 */
const inputCardInViewport = () => {
  const el = document.querySelector<HTMLElement>(".input-content");
  if (!el) return false;
  const box = el.getBoundingClientRect();
  return box.y >= 0 && box.y + box.height <= window.innerHeight;
};

describe("Desktop mod composer overflow guards", () => {
  it("60 行的带在带里滚动，输入卡仍在视口内", async () => {
    await page.viewport(1180, 760);
    setup();
    expect(isVisible('[data-testid="message-input"]')).toBe(true);

    sendCommand("desktopModBand", {
      bands: [
        { modId: "todo:band", plugin: "todo", revision: 1, tree: tallTree },
      ],
    });
    await expect.poll(() => isVisible('[data-testid="mod-band"]')).toBe(true);

    const band = metrics(".mod-band");
    expect(band).toBeTruthy();
    if (!band) return;
    // 视口 760 的 30% = 228，CC 的 11lh+40 也不该超；上下各 10px 是滚动内衬，
    // 算在 border-box 里。
    expect(band.h).toBeLessThanOrEqual(230);
    // 超出的部分留在带内部滚动，而不是把整页撑开。
    expect(band.scrollH).toBeGreaterThan(band.clientH);
    expect(inputCardInViewport()).toBe(true);
  });

  it("1 万字符的状态行单行省略，输入卡仍在视口内", async () => {
    await page.viewport(1180, 760);
    setup();
    expect(isVisible('[data-testid="message-input"]')).toBe(true);

    sendCommand("desktopModStatus", {
      payload: { modId: "todo:status", plugin: "todo", text: LONG_TEXT },
    });
    await expect.poll(() => isVisible('[data-testid="mod-status"]')).toBe(true);

    const status = metrics(".mod-status");
    const text = metrics(".mod-status-text");
    expect(status && text).toBeTruthy();
    if (!status || !text) return;

    // 单行（12px 字 / 行高 1.6 ≈ 19px，给一档余量）。
    expect(status.h).toBeLessThanOrEqual(30);
    // 超出的字符靠省略号收住，不是换行撑高。
    expect(text.clientW).toBeGreaterThan(0);
    expect(text.scrollW).toBeGreaterThan(text.clientW);
    expect(inputCardInViewport()).toBe(true);
  });

  it("多个插件的状态行放不下的收成 +N，整行不换行", async () => {
    await page.viewport(1180, 760);
    setup();
    expect(isVisible('[data-testid="message-input"]')).toBe(true);

    for (let i = 0; i < 8; i += 1) {
      sendCommand("desktopModStatus", {
        payload: {
          modId: `todo:s${i}`,
          plugin: `mod${i + 1}`,
          text: statusText(i),
        },
      });
    }
    await expect.poll(() => isVisible('[data-testid="mod-status"]')).toBe(true);
    await expect
      .poll(() => isVisible('[data-testid="mod-status-rest"]'))
      .toBe(true);
    await expect
      .poll(
        () =>
          document.querySelector('[data-testid="mod-status-rest"]')
            ?.textContent ?? "",
      )
      .toMatch(/^\+\d+$/);

    const status = metrics(".mod-status");
    expect(status).toBeTruthy();
    if (!status) return;
    expect(status.h).toBeLessThanOrEqual(30);
    // 收起来的条数 = 总数 − 显示段数。
    const shown = document.querySelectorAll(
      ".mod-status > .mod-status-line",
    ).length;
    const hidden = Number(
      (
        document.querySelector('[data-testid="mod-status-rest"]')
          ?.textContent ?? ""
      ).slice(1),
    );
    expect(shown + hidden).toBe(8);
    expect(hidden).toBeGreaterThan(0);
  });

  it("提示是右下角浮层：不占输入区，整块收在视口内", async () => {
    await page.viewport(1180, 760);
    setup();
    expect(isVisible('[data-testid="message-input"]')).toBe(true);

    for (let i = 0; i < 6; i += 1) {
      sendCommand("desktopModToast", {
        payload: {
          modId: `todo:t${i}`,
          plugin: "todo",
          text: `第 ${i + 1} 条提示：${"已勾掉一项，".repeat(120)}`,
          timeoutMs: 600_000,
        },
      });
    }
    await expect.poll(() => isVisible('[data-testid="mod-toast"]')).toBe(true);

    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const toasts = metrics(".mod-toasts");
    const one = metrics(".mod-toast");
    expect(viewport && toasts && one).toBeTruthy();
    if (!viewport || !toasts || !one) return;

    // 固定右下角、360px（CC 的 cds Toast 就是这个档）。
    expect(toasts.w).toBe(360);
    expect(
      Math.abs(toasts.x + toasts.w - (viewport.width - 16)),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(toasts.y + toasts.h - (viewport.height - 16)),
    ).toBeLessThanOrEqual(1);
    const position = getComputedStyle(
      document.querySelector(".mod-toasts") as Element,
    ).position;
    expect(position).toBe("fixed");

    // 单条：240 字符 + 4 行 clamp，再长也不会长成一屏。
    expect(one.h).toBeLessThanOrEqual(120);
    // 浮层不出视口（50 条排队时在浮层里滚）。
    expect(toasts.h).toBeLessThanOrEqual(viewport.height - 32);
    expect(inputCardInViewport()).toBe(true);
  });
});
