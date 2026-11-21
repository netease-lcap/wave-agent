import { test, expect } from "./utils/webviewTestHarness.js";
import { MessageInjector } from "./utils/messageInjector.js";
import { Message } from "wave-agent-sdk";
import { BASH_TOOL_NAME } from "wave-agent-sdk/constants";

/**
 * 消息动作按钮的**触控档**（手机 / 远控页）：没有悬停能力，`:hover` 由 tap 建立
 * （粘滞 hover）。按钮与桌面走同一条规则：点一下消息才出现、再点按钮才生效。曾经
 * 在触控档常显过（`@media (hover: none)` 里 `display: flex`），2026-11-01 他判定
 * 不要 —— 页面上永远挂着两颗按钮、还压在内容上，远不如默认的「点一下再显示」。
 *
 * 桌面档（同一条用例的几何部分：两颗按钮的 right/top 偏移、按钮整颗落在本条消息
 * 内、`.message` 是定位上下文、两颗类名一致）已迁到
 * `tests/webview/messageActionGeometry.test.tsx`。触控这条留在 e2e：它要
 * `hasTouch` / `isMobile` / 真实 UA 与 `.tap()`，而 vitest browser 的设备参数只能
 * 按 browser 实例配（不能按 test 配）、`userEvent` 也没有 tap —— 搬过去只会把触控
 * 语义悄悄降级成普通 hover。
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
