import { test, expect } from "../e2e/utils/desktopTestHarness.js";
import { MessageInjector } from "../e2e/utils/messageInjector.js";

/**
 * 斜杠命令弹层：选项**恒为一行**，描述走右侧气泡（悬停 / 键盘选中），只有没有悬停
 * 能力的设备才在选项内显示描述（CSS `hover: none`）。
 *
 * 旧形态是「名称行 + 描述最多两行」，长描述把选项从 ~40 撑到 ~60，长短混排的列表高度
 * 参差 —— 弹窗本身早有 `max-height`，失控的是单项。这里用真浏览器几何钉住：
 * 1. 三个选项等高（描述长短不影响）；
 * 2. 有 `hover: hover` 时选项内描述不可见；
 * 3. 描述在右侧气泡里，且跟着悬停 / 键盘选中走。
 */
const DIR_A = "/Users/dev/projects/wave-agent";

// 刻意写长：这条描述曾经能把选项撑成两行。
const LONG_DESCRIPTION =
  "回滚到之前的用户消息，并把会话上下文一并恢复到那一条之后，适合在试错之后重新来过；这条描述故意写得很长，因为它要证明长描述不会再把这个选项撑高";

const initialState = {
  messages: [],
  isStreaming: false,
  sessions: [],
  isAuthenticated: true,
  permissionMode: "default",
};

interface RowBox {
  name: string;
  height: number;
  descriptionDisplay: string | null;
}

async function openPopup(
  webviewPage: import("@playwright/test").Page,
): Promise<RowBox[]> {
  const injector = new MessageInjector(webviewPage);
  await webviewPage.setViewportSize({ width: 700, height: 600 });
  await injector.simulateExtensionMessage("desktopWorkdirState", {
    workdir: DIR_A,
    recentWorkdirs: [DIR_A],
    host: "local",
    hosts: ["local"],
  });
  await injector.waitForChatAppReady();
  await injector.simulateExtensionMessage("setInitialState", initialState);

  await webviewPage.focus('[data-testid="message-input"]');
  await webviewPage.keyboard.type("/");
  await webviewPage.waitForFunction(() => {
    const messages = window.getTestMessages ? window.getTestMessages() : [];
    return messages.some((m) => m.command === "requestSlashCommands");
  });
  await injector.simulateExtensionMessage("slashCommandsResponse", {
    commands: [
      { id: "rewind", name: "rewind", description: "回滚到之前的用户消息" },
      {
        id: "artifact",
        name: "artifact",
        description: LONG_DESCRIPTION,
        skillSource: "builtin",
      },
      {
        id: "loop",
        name: "loop",
        description: "按固定间隔反复执行提示词",
        skillSource: "user",
      },
    ],
  });
  await webviewPage.waitForSelector(".slash-command-item", {
    state: "visible",
  });

  return webviewPage.evaluate<RowBox[]>(() =>
    Array.from(document.querySelectorAll(".slash-command-item")).map((item) => {
      const name = item.querySelector(".slash-command-name");
      const description = item.querySelector(".slash-command-description");
      return {
        name: name?.textContent ?? "",
        height: Math.round(item.getBoundingClientRect().height),
        descriptionDisplay: description
          ? getComputedStyle(description).display
          : null,
      };
    }),
  );
}

test.describe("Slash popup row layout", () => {
  test("long descriptions no longer make their row taller", async ({
    webviewPage,
  }) => {
    const rows = await openPopup(webviewPage);
    expect(rows.map((r) => r.name)).toEqual(["/rewind", "/artifact", "/loop"]);

    // 三个选项等高 —— 长的 /artifact 描述不再把这一项撑成两行。
    const heights = new Set(rows.map((r) => r.height));
    expect(
      [...heights],
      `row heights should be uniform, got ${JSON.stringify(rows)}`,
    ).toHaveLength(1);

    // 单行：名称行 + 上下内衬，不会超过名称行两倍的高度。
    expect(rows[0].height).toBeLessThanOrEqual(32);

    // 有悬停能力的环境（Chromium 默认 `hover: hover`）里，描述不出现在列表内。
    for (const row of rows) expect(row.descriptionDisplay).toBe("none");
  });

  test("the description follows hover and keyboard selection in a side tooltip", async ({
    webviewPage,
  }) => {
    await openPopup(webviewPage);

    const bubble = webviewPage.locator(".tooltip-box.tooltip-right.visible");

    // 第一项默认选中：右侧气泡给出它的描述。
    await expect(bubble).toHaveCount(1);
    await expect(bubble).toHaveText("回滚到之前的用户消息");

    // 键盘 ↓ 到第二项：气泡换成那条长描述（焦点在输入框，没有 hover 可依赖）。
    await webviewPage.keyboard.press("ArrowDown");
    await expect(bubble).toHaveCount(1);
    await expect(bubble).toHaveText(LONG_DESCRIPTION);

    // 鼠标悬停第三项：只剩悬停项那颗气泡，选中项那颗让位。
    await webviewPage
      .locator('[data-testid="slash-command-loop"] .slash-command-row')
      .hover();
    await expect(bubble).toHaveCount(1);
    await expect(bubble).toHaveText("按固定间隔反复执行提示词");
  });
});
