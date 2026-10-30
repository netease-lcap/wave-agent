import {
  test,
  expect,
  openWebviewOnHttpOrigin,
} from "./utils/desktopTestHarness.js";
import { MessageInjector } from "./utils/messageInjector.js";

// 真实浏览器里验证「侧栏分组折叠状态记忆」（spec
// docs/specs/desktop/desktop-sessions.md）——jsdom 单测已经覆盖了逻辑，这里补
// jsdom 给不了的那一半：状态真的落在浏览器存储里、跨一次页面重载（= 桌面端重启
// 后 webview 重新加载）还在。
//
// 必须用 http origin：`page.setContent` 的文档跑在 about:blank 上，origin 是
// opaque 的 "null"，真实 Chromium 会拒掉 localStorage。

const DIR_A = "/Users/dev/projects/wave-agent";
const DIR_B = "/Users/dev/projects/shop-server";

const treeSession = (sessionId: string, title: string) => ({
  sessionId,
  title,
  lastActiveAt: Date.now(),
  hasWorktree: false,
  running: false,
  waitingConfirmation: false,
});

const initialState = {
  messages: [],
  isStreaming: false,
  sessions: [],
  isAuthenticated: true,
  permissionMode: "default",
};

/** 注入一份两分组的会话树（重启前后各调用一次）。 */
const injectShell = async (page: import("@playwright/test").Page) => {
  const injector = new MessageInjector(page);
  await injector.simulateExtensionMessage("desktopWorkdirState", {
    workdir: DIR_A,
    recentWorkdirs: [DIR_A, DIR_B],
  });
  await injector.simulateExtensionMessage("desktopSessionTree", {
    groups: [
      {
        host: "local",
        workdir: DIR_A,
        sessions: [treeSession("s1", "会话一")],
      },
      {
        host: "local",
        workdir: DIR_B,
        sessions: [treeSession("s2", "会话二")],
      },
    ],
  });
  await injector.waitForChatAppReady();
  await injector.simulateExtensionMessage("setInitialState", initialState);
};

test.describe("Desktop sidebar group collapse memory", () => {
  test("keeps a collapsed group collapsed after the webview reloads", async ({
    page,
  }) => {
    await openWebviewOnHttpOrigin(page);
    await page.setViewportSize({ width: 960, height: 720 });
    await injectShell(page);

    // 两个分组默认都展开。
    await expect(page.getByTestId("desktop-session-main-s1")).toBeVisible();
    await expect(page.getByTestId("desktop-session-main-s2")).toBeVisible();

    await page.getByRole("button", { name: "收起分组 wave-agent" }).click();
    await expect(page.getByTestId("desktop-session-main-s1")).toHaveCount(0);
    await expect(page.getByTestId("desktop-session-main-s2")).toBeVisible();

    // 状态真的落在浏览器存储里 —— 桌面端重启后 webview 重新加载靠的就是它。
    expect(
      await page.evaluate(() =>
        localStorage.getItem("wave.desktopSidebarGroupCollapsed"),
      ),
    ).toBe(JSON.stringify({ [`local:${DIR_A}`]: true }));

    // 重启 = 页面重载：只有持久化下来的状态能跨过这次重载。
    await page.reload();
    await injectShell(page);

    await expect(page.getByTestId("desktop-session-main-s1")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "展开分组 wave-agent" }),
    ).toBeVisible();
    await expect(page.getByTestId("desktop-session-main-s2")).toBeVisible();
  });
});
