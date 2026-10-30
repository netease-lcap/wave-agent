import { test, expect } from "./utils/webviewTestHarness.js";
import { MessageInjector } from "./utils/messageInjector.js";
import { Message } from "wave-agent-sdk";
import { BASH_TOOL_NAME } from "wave-agent-sdk/constants";

/**
 * 消息右上角的动作按钮几何（回滚 vs 转后台）。
 *
 * 两颗按钮是同一个 `MessageActionButton`，靠 `.message-actions` 的
 * `position: absolute; top: -12px; right: 8px` 钉在消息右上角，所以两者相对各自
 * 消息的偏移必须逐像素相同 —— jsdom 没有布局，只能在真 Chromium 里验。
 * 这条用例同时锁住 `.message` 自身是定位上下文（缺 `position: relative` 时按钮
 * 会跑到错误的祖先上，偏移立刻能看出来）。
 */
test.describe("Message action button geometry", () => {
  test("rewind and background buttons share one offset on their own message", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);

    const messages: Message[] = [
      {
        id: "u1",
        role: "user",
        timestamp: "2025-07-09T10:30:00.000Z",
        blocks: [{ type: "text", content: "跑一下测试。" }],
      },
      {
        id: "a1",
        role: "assistant",
        timestamp: "2025-07-09T10:30:01.000Z",
        blocks: [
          { type: "text", content: "开始跑。" },
          {
            type: "tool",
            name: BASH_TOOL_NAME,
            stage: "running",
            parameters: JSON.stringify({ command: "pnpm test" }),
          },
        ],
      },
    ];

    await injector.simulateExtensionMessage("setInitialState", {
      isAuthenticated: true,
      messages: [],
      isStreaming: true,
      sessions: [],
      permissionMode: "default",
    });

    await injector.updateMessages(messages);
    await injector.startStreaming();

    const backgroundBtn = webviewPage.getByTestId("background-current-task");
    const rewindBtn = webviewPage.getByTestId("rewind-to-message");

    const userMessage = webviewPage.locator(".message.user").first();
    const assistantMessage = webviewPage.locator(".message.assistant").first();

    // 悬停才出现（两条共用的 `.message:hover .message-actions` 规则）。
    await expect(backgroundBtn).toBeHidden();
    await assistantMessage.hover();
    await expect(backgroundBtn).toBeVisible();
    // 能悬停的设备上 tooltip 照常出现（触控档那条断言相反，见本文件后半段）：
    // 气泡挂在按钮自己身上，所以要 hover 到按钮而不是消息。
    await backgroundBtn.hover();
    await expect(webviewPage.locator(".tooltip-box.visible")).toHaveCount(1);
    await userMessage.hover();
    await expect(rewindBtn).toBeVisible();
    await expect(backgroundBtn).toBeHidden();

    // 两个按钮各自的偏移从 DOM 里读，逐项比对。
    const read = async (btnTestId: string, msgSelector: string) =>
      webviewPage.evaluate(
        ([testId, selector]) => {
          const btn = document.querySelector<HTMLElement>(
            `[data-testid="${testId}"]`,
          )!;
          const msg = document.querySelector<HTMLElement>(selector)!;
          const b = btn.getBoundingClientRect();
          const m = msg.getBoundingClientRect();
          return {
            // 按钮右边缘到消息右边缘的距离（CSS: right: 8px）
            fromRight: m.right - b.right,
            // 按钮顶边到消息顶边的距离（CSS: top: -12px ⇒ 负值）
            fromTop: b.top - m.top,
          };
        },
        [btnTestId, msgSelector],
      );

    await assistantMessage.hover();
    const bg = await read("background-current-task", ".message.assistant");
    await userMessage.hover();
    const rewind = await read("rewind-to-message", ".message.user");

    expect(bg.fromRight).toBeCloseTo(8, 0);
    expect(bg.fromTop).toBeCloseTo(-12, 0);
    // 同一套样式 ⇒ 相对各自消息的偏移完全一致
    expect(bg).toEqual(rewind);

    // 定位上下文必须是消息自身。助手消息曾经不是：`.message-actions` 一路找到
    // `.virtual-row`（absolute）当包含块，只是那边框与消息恰好重合才看着没错，
    // 行内 padding 一变按钮就会漂。
    const positions = await webviewPage.evaluate(() =>
      [".message.user", ".message.assistant"].map(
        (s) =>
          getComputedStyle(document.querySelector<HTMLElement>(s)!).position,
      ),
    );
    expect(positions).toEqual(["relative", "relative"]);

    // 两颗按钮的类名/图标容器约定相同（同一组件产出）
    await assistantMessage.hover();
    const bgClass = await webviewPage
      .getByTestId("background-current-task")
      .getAttribute("class");
    await userMessage.hover();
    const rewindClass = await webviewPage
      .getByTestId("rewind-to-message")
      .getAttribute("class");
    expect(bgClass).toBe(rewindClass);
  });
});

/**
 * 触控档（手机 / 远控页）：没有悬停能力，`:hover` 由 tap 建立（粘滞 hover）。
 * 按钮与桌面走同一条规则：点一下消息才出现、再点按钮才生效。曾经在触控档常显过
 * （`@media (hover: none)` 里 `display: flex`），2026-11-01 他判定不要 —— 页面上
 * 永远挂着两颗按钮、还压在内容上，远不如默认的「点一下再显示」。
 */
test.describe("Message action buttons on a touch device", () => {
  test.use({
    remotePage: true,
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 3,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  });

  test("buttons appear after tapping the message, then one tap acts", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);

    const messages: Message[] = [
      {
        id: "u1",
        role: "user",
        timestamp: "2025-07-09T10:30:00.000Z",
        blocks: [{ type: "text", content: "跑一下测试。" }],
      },
      {
        id: "a1",
        role: "assistant",
        timestamp: "2025-07-09T10:30:01.000Z",
        blocks: [
          { type: "text", content: "开始跑。" },
          {
            type: "tool",
            name: BASH_TOOL_NAME,
            stage: "running",
            parameters: JSON.stringify({ command: "pnpm test" }),
          },
        ],
      },
    ];

    await injector.simulateExtensionMessage("setInitialState", {
      isAuthenticated: true,
      messages: [],
      isStreaming: true,
      sessions: [],
      permissionMode: "default",
    });
    await injector.updateMessages(messages);
    await injector.startStreaming();

    const backgroundBtn = webviewPage.getByTestId("background-current-task");
    const rewindBtn = webviewPage.getByTestId("rewind-to-message");

    // 谁都没碰过：两颗都不显示（与触控档常显那版相反）
    await expect(backgroundBtn).toBeHidden();
    await expect(rewindBtn).toBeHidden();

    // tap 消息正文：触控设备上 `:hover` 由这次 tap 建立并粘住，按钮随之出现。
    // 只出属于这条消息的那一颗 —— 回滚挂在用户消息上，它不跟着亮。
    await webviewPage.getByText("开始跑。").tap();
    await expect(backgroundBtn).toBeVisible();
    await expect(rewindBtn).toBeHidden();

    await webviewPage.evaluate(() => window.clearTestMessages?.());
    await backgroundBtn.tap();

    const sent = await webviewPage.evaluate(
      () => window.getTestMessages?.() ?? [],
    );
    expect(
      sent.some(
        (m) => (m as { command?: string }).command === "backgroundCurrentTask",
      ),
    ).toBe(true);

    // 触控设备不弹 tooltip（`hover: none` 下组件直接不显示）：否则气泡被 tap 点出来
    // 之后不会自己走，会一直压在这轮内容上。
    const tooltipVisible = await webviewPage.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>(".tooltip-box")].some((el) =>
        el.classList.contains("visible"),
      ),
    );
    expect(tooltipVisible).toBe(false);

    // 手机视口的实物形态（tap 之后的那一颗，触控档字号）留一张给人工看
    await webviewPage.screenshot({
      path: "/tmp/message-actions-touch.png",
      fullPage: false,
    });
  });
});
