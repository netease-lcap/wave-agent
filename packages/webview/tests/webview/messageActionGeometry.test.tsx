/**
 * 消息右上角的动作按钮几何（回滚 vs 转后台）。
 *
 * 两颗按钮是同一个 `MessageActionButton`，靠 `.message-actions` 的
 * `position: absolute; right: 8px` 钉在消息右上角。Y 轴分两档，原因是两种角色
 * 的盒子结构不同、不是按设备分档：用户消息首块是自带 8px 内边距的气泡，
 * `top: -12px` 让它骑在气泡右肩；助手消息没有背景盒、首块只有 10px 内边距，
 * 同样 -12px 会把按钮整颗顶到盒外、压进**上一条**消息（两条消息的盒子甚至相切），
 * 所以助手那一颗落在本条消息的首行上（`top: 8px`，与首行文字同一水平带）。
 * 这条用例同时锁住 `.message` 自身是定位上下文（缺 `position: relative` 时按钮
 * 会跑到错误的祖先上，偏移立刻能看出来）。
 *
 * 迁移自 `e2e/message-action-geometry.e2e.ts` 的桌面那条。同文件的触控那条
 * （`test.use({ hasTouch, isMobile, deviceScaleFactor, userAgent })` + `.tap()` +
 * `@media (hover: none)`）**没有**迁过来：browser mode 的 `userEvent` 没有 tap、
 * 设备参数只能按 browser 实例配（不能按 test 配），搬过来只会把触控语义悄悄降级
 * 成普通 hover。它留在 e2e 里。
 */

import { describe, it, expect } from "vitest";
import { userEvent } from "vitest/browser";
import { renderChatApp, sendCommand } from "./test-utils";
import { BASH_TOOL_NAME } from "wave-agent-sdk/constants";

const text = (content: string) => ({ type: "text", content });

/** 两帧：等布局与定位收敛。 */
const twoFrames = () =>
  new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(null))),
  );

/** 按钮到所属消息盒的偏移，以及各自盒子的定位值。 */
function readOffsets(btnTestId: string, msgSelector: string) {
  const btn = document.querySelector<HTMLElement>(
    `[data-testid="${btnTestId}"]`,
  )!;
  const msg = document.querySelector<HTMLElement>(msgSelector)!;
  const b = btn.getBoundingClientRect();
  const m = msg.getBoundingClientRect();
  return {
    // 按钮右边缘到消息右边缘的距离（CSS: right: 8px）
    fromRight: m.right - b.right,
    // 按钮顶边到消息顶边的距离（用户消息 -12px / 助手消息 8px）
    fromTop: b.top - m.top,
  };
}

/**
 * 按钮的可见性，按 Playwright `toBeVisible` / `toBeHidden` 的同一套判据：元素有
 * 非空盒就算可见。显隐由外壳 `.message-actions` 的 `display: none ↔ flex` 决定，
 * 按钮自己恒是 `display: flex`（`.message-action-btn` 就是布局盒），所以量盒而不是
 * 量按钮自己的 display —— 祖先 display:none 时盒退化成 0×0。
 */
function buttonState(testId: string) {
  const btn = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  if (!btn) return { visible: false, actionsDisplay: "missing" };
  const rect = btn.getBoundingClientRect();
  // 按钮外面还包了一层 tooltip 宿主，显隐规则挂在 `.message-actions` 上。
  const actions = btn.closest(".message-actions");
  return {
    visible: rect.width > 0 && rect.height > 0,
    actionsDisplay: actions ? getComputedStyle(actions).display : "missing",
  };
}
const isVisible = (testId: string) => buttonState(testId).visible;

describe("Message action button geometry", () => {
  it("rewind and background buttons share one offset on their own message", async () => {
    renderChatApp();
    sendCommand("setInitialState", {
      isAuthenticated: true,
      messages: [],
      isStreaming: true,
      sessions: [],
      permissionMode: "default",
    });
    sendCommand("updateMessages", {
      messages: [
        {
          id: "u1",
          role: "user",
          timestamp: "2025-07-09T10:30:00.000Z",
          blocks: [text("跑一下测试。")],
        },
        {
          id: "a1",
          role: "assistant",
          timestamp: "2025-07-09T10:30:01.000Z",
          blocks: [
            text("开始跑。"),
            {
              type: "tool",
              name: BASH_TOOL_NAME,
              stage: "running",
              parameters: JSON.stringify({ command: "pnpm test" }),
            },
          ],
        },
      ],
    });
    sendCommand("startStreaming");

    const userMessage = document.querySelector<HTMLElement>(".message.user")!;
    const assistantMessage =
      document.querySelector<HTMLElement>(".message.assistant")!;
    await expect.poll(() => !!assistantMessage).toBe(true);
    await twoFrames();

    // 悬停才出现（两条共用的 `.message:hover .message-actions` 规则）。
    expect(buttonState("background-current-task")).toEqual({
      visible: false,
      actionsDisplay: "none",
    });
    await userEvent.hover(assistantMessage);
    await vi.waitFor(() =>
      expect(isVisible("background-current-task")).toBe(true),
    );
    // 能悬停的设备上 tooltip 照常出现（触控档那条断言相反，见 e2e 里的触控档）：
    // 气泡挂在按钮自己身上，所以要 hover 到按钮而不是消息。
    await userEvent.hover(
      document.querySelector<HTMLElement>(
        '[data-testid="background-current-task"]',
      )!,
    );
    await vi.waitFor(() =>
      expect(document.querySelectorAll(".tooltip-box.visible").length).toBe(1),
    );
    await userEvent.hover(userMessage);
    await vi.waitFor(() => expect(isVisible("rewind-to-message")).toBe(true));
    expect(isVisible("background-current-task")).toBe(false);

    // 两个按钮各自的偏移从 DOM 里读，逐项比对。
    await userEvent.hover(assistantMessage);
    const bg = readOffsets("background-current-task", ".message.assistant");
    await userEvent.hover(userMessage);
    const rewind = readOffsets("rewind-to-message", ".message.user");

    expect(bg.fromRight).toBeCloseTo(8, 0);
    expect(rewind.fromRight).toBeCloseTo(8, 0);
    // 助手消息那颗落在本条消息的首行上：盒顶往下 8px，按钮中心与首行文字同一
    // 水平带（0 也落在盒内，但顶边正好压在上一条的盒底线上，看着像挂在上一条的
    // 下沿 —— 2026-11-01 四档实测 0 / 4 / 8 / 12，他选了 8）。
    expect(bg.fromTop).toBeCloseTo(8, 0);
    // 用户消息那颗仍骑在气泡右肩（气泡首块自带 8px 内边距，-12 有一半在气泡里、
    // 归属看得出），这一档 2026-10-31 定的，没跟着改。
    expect(rewind.fromTop).toBeCloseTo(-12, 0);

    // 他 2026-11-01 报的原话：「还是跟上一个消息重叠了，我还是期望它能够跟当前
    // 消息重叠」。助手消息那颗按钮必须整颗落在自己这条的垂直范围内，与上一条
    // 消息的盒子不相交。
    await userEvent.hover(assistantMessage);
    const btn = document.querySelector<HTMLElement>(
      '[data-testid="background-current-task"]',
    )!;
    const b = btn.getBoundingClientRect();
    const m = assistantMessage.getBoundingClientRect();
    const p = userMessage.getBoundingClientRect();
    expect({
      insideSelf: b.top >= m.top && b.bottom <= m.bottom,
      overlapsPrev: b.top < p.bottom,
    }).toEqual({ insideSelf: true, overlapsPrev: false });

    // 定位上下文必须是消息自身。助手消息曾经不是：`.message-actions` 一路找到
    // `.virtual-row`（absolute）当包含块，只是那边框与消息恰好重合才看着没错，
    // 行内 padding 一变按钮就会漂。
    expect([
      getComputedStyle(userMessage).position,
      getComputedStyle(assistantMessage).position,
    ]).toEqual(["relative", "relative"]);

    // 两颗按钮的类名/图标容器约定相同（同一组件产出）
    await userEvent.hover(assistantMessage);
    const bgClass = document
      .querySelector<HTMLElement>('[data-testid="background-current-task"]')!
      .getAttribute("class");
    await userEvent.hover(userMessage);
    const rewindClass = document
      .querySelector<HTMLElement>('[data-testid="rewind-to-message"]')!
      .getAttribute("class");
    expect(bgClass).toBe(rewindClass);
  });
});
