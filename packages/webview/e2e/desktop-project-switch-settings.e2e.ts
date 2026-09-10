import { test, expect } from "./utils/desktopTestHarness.js";
import type { Page } from "@playwright/test";
import { MessageInjector } from "./utils/messageInjector.js";

/**
 * Regression e2e (real browser, desktop mode) — 多项目切换时「项目设置 / 个性化」
 * 显示的是当前聚焦项目，而不是 recents 头部或上一个项目的旧快照。
 *
 * 出处：
 *  - PR #2155 桌面「项目设置 → SDD 开关」不随聚焦会话的项目切换（host 已按聚焦
 *    pane 回包，但 webview 归属守卫用 effectiveWorkdir = recents 头优先，把正确
 *    回包当过期丢弃、SettingsPage 继续信任上一项目快照）。
 *  - PR #2152 桌面「个性化 → 项目级 AGENTS.md」只显示第一个项目的值（编辑器缓存
 *    不按 workdir 键控、只随首次加载填充且从不失效 → 每次打开重读当前项目）。
 *
 * 关键：host.workdir（desktopWorkdirState.workdir）是「当前聚焦项目」的权威
 * 来源；recents 头（recentWorkdirs[0]）恢复历史会话时不更新，因此这里刻意让
 * recents 头停在项目 A，把聚焦项目切到 B。
 */

const DIR_A = "/Users/dev/projects/wave-agent";
const DIR_B = "/Users/dev/projects/shop-server";

const initialState = {
  messages: [],
  isStreaming: false,
  sessions: [],
  isAuthenticated: true,
  configurationData: {
    baseURL: "https://api.anthropic.com/v1",
    model: "claude-sonnet-4-20250514",
  },
  permissionMode: "default",
};

const accountInfo = {
  isAuthenticated: true,
  user: { id: "user-1", email: "alice@example.com" },
  plan: null,
  apiQuota: null,
};

const sessionTree = [
  {
    workdir: DIR_A,
    sessions: [
      {
        sessionId: "sess-a1",
        title: "项目 A 的会话",
        lastActiveAt: new Date("2026-07-27T10:12:00Z").getTime(),
        hasWorktree: false,
        running: false,
        waitingConfirmation: false,
      },
    ],
  },
  {
    workdir: DIR_B,
    sessions: [
      {
        sessionId: "sess-b1",
        title: "项目 B 的会话",
        lastActiveAt: new Date("2026-07-27T09:12:00Z").getTime(),
        hasWorktree: false,
        running: false,
        waitingConfirmation: false,
      },
    ],
  },
];

/** 启动到「聚焦 pane 已在项目 A」的稳定态。 */
async function setupFocusedOnA(webviewPage: Page) {
  const injector = new MessageInjector(webviewPage);
  await webviewPage.setViewportSize({ width: 1280, height: 800 });
  await injector.simulateExtensionMessage("desktopWorkdirState", {
    workdir: DIR_A,
    recentWorkdirs: [DIR_A],
  });
  await injector.waitForChatAppReady();
  await injector.simulateExtensionMessage("setInitialState", initialState);
  await injector.simulateExtensionMessage("desktopSessionTree", {
    groups: sessionTree,
  });
  await injector.simulateExtensionMessage("desktopPanes", {
    panes: [{ paneId: "pane-1", sessionId: "sess-a1", host: "local", row: 0 }],
    focusedPaneId: "pane-1",
  });
  await injector.simulateExtensionMessage("desktopAccountInfo", accountInfo);
  await expect(webviewPage.getByTestId("desktop-sidebar")).toBeVisible();
  return injector;
}

/** 聚焦 pane 切到项目 B 的会话（recents 头保持 A，模拟恢复历史会话）。 */
async function focusProjectB(injector: MessageInjector) {
  await injector.simulateExtensionMessage("desktopWorkdirState", {
    workdir: DIR_B,
    recentWorkdirs: [DIR_A],
  });
  await injector.simulateExtensionMessage("desktopPanes", {
    panes: [{ paneId: "pane-1", sessionId: "sess-b1", host: "local", row: 0 }],
    focusedPaneId: "pane-1",
  });
}

async function openSettings(webviewPage: Page) {
  await webviewPage.getByTestId("account-card-hotzone").click();
  await expect(webviewPage.getByTestId("more-menu")).toBeVisible();
  await webviewPage.getByTestId("more-menu-settings").click();
  await expect(webviewPage.locator(".settings-page")).toBeVisible();
}

async function closeSettings(webviewPage: Page) {
  await webviewPage.getByRole("button", { name: "返回" }).click();
  await expect(webviewPage.locator(".settings-page")).toHaveCount(0);
}

async function enterProjectSettings(webviewPage: Page) {
  await webviewPage
    .locator(".settings-nav-item", { hasText: "项目设置" })
    .click();
  await expect(
    webviewPage.getByRole("heading", { name: "项目设置" }),
  ).toBeVisible();
}

function sddSwitch(webviewPage: Page) {
  return webviewPage.locator(
    '.settings-switch input[aria-label="启用 SDD 插件"]',
  );
}

function projectSettingsRequests(webviewPage: Page): Promise<number> {
  return webviewPage.evaluate(
    () =>
      (
        (
          window as unknown as { getTestMessages?: () => unknown[] }
        ).getTestMessages?.() ?? []
      ).filter(
        (m) => (m as { command?: string }).command === "getProjectSettings",
      ).length,
  );
}

test.describe("桌面多项目切换：项目设置 / AGENTS.md 跟随聚焦项目", () => {
  test("SDD 开关随聚焦项目切换：B 回包生效、A 旧快照不回显、过期回包被丢弃", async ({
    webviewPage,
  }) => {
    const injector = await setupFocusedOnA(webviewPage);

    await openSettings(webviewPage);
    await enterProjectSettings(webviewPage);

    // 进入项目设置视图触发拉取
    await expect.poll(() => projectSettingsRequests(webviewPage)).toBe(1);

    // 项目 A 启用 SDD → 开关勾选且可用
    await injector.simulateExtensionMessage("projectSettings", {
      workdir: DIR_A,
      enabledPlugins: { "sdd@builtin": true },
    });
    const sdd = sddSwitch(webviewPage);
    await expect(sdd).toBeEnabled();
    await expect(sdd).toBeChecked();

    // 聚焦项目切到 B（recents 头仍为 A）→ 设置页按新 workdir 重拉
    await focusProjectB(injector);
    await expect.poll(() => projectSettingsRequests(webviewPage)).toBe(2);

    // 若此刻切项目但 B 的回包还没到：开关不得继续显示 A 的勾选（按未加载禁用）
    await expect(sdd).toBeDisabled();
    await expect(sdd).not.toBeChecked();

    // B 回包（未启用）→ 开关未勾选且可用
    await injector.simulateExtensionMessage("projectSettings", {
      workdir: DIR_B,
      enabledPlugins: {},
    });
    await expect(sdd).toBeEnabled();
    await expect(sdd).not.toBeChecked();

    // 迟到的 A 旧回包（归属不匹配）→ 被归属守卫丢弃，不得把开关翻回勾选
    await injector.simulateExtensionMessage("projectSettings", {
      workdir: DIR_A,
      enabledPlugins: { "sdd@builtin": true },
    });
    await webviewPage.waitForTimeout(150);
    await expect(sdd).not.toBeChecked();
    await expect(sdd).toBeEnabled();
  });

  test("切回项目 A 时重新显示 A 的 SDD 值（往返切换不残留）", async ({
    webviewPage,
  }) => {
    const injector = await setupFocusedOnA(webviewPage);
    await openSettings(webviewPage);
    await enterProjectSettings(webviewPage);

    await injector.simulateExtensionMessage("projectSettings", {
      workdir: DIR_A,
      enabledPlugins: { "sdd@builtin": true },
    });
    const sdd = sddSwitch(webviewPage);
    await expect(sdd).toBeChecked();

    // A → B
    await focusProjectB(injector);
    await injector.simulateExtensionMessage("projectSettings", {
      workdir: DIR_B,
      enabledPlugins: { "sdd@builtin": false },
    });
    await expect(sdd).not.toBeChecked();

    // B → A（recents 头一直是 A；切回靠 host.workdir 变化）
    await injector.simulateExtensionMessage("desktopWorkdirState", {
      workdir: DIR_A,
      recentWorkdirs: [DIR_A],
    });
    await injector.simulateExtensionMessage("desktopPanes", {
      panes: [
        { paneId: "pane-1", sessionId: "sess-a1", host: "local", row: 0 },
      ],
      focusedPaneId: "pane-1",
    });
    await injector.simulateExtensionMessage("projectSettings", {
      workdir: DIR_A,
      enabledPlugins: { "sdd@builtin": true },
    });
    await expect(sdd).toBeChecked();
    await expect(sdd).toBeEnabled();
  });

  test("点击开关按当前项目 scope 提交（切到 B 后点击仍 post setBuiltinPluginEnabled project）", async ({
    webviewPage,
  }) => {
    const injector = await setupFocusedOnA(webviewPage);
    await openSettings(webviewPage);
    await enterProjectSettings(webviewPage);

    await focusProjectB(injector);
    // 切项目后必须等 webview 认下新「当前项目」再注入回包：settingsWorkdir 的
    // ref 同步在 passive effect 里（ChatApp.tsx:643-649），紧接着注入的回包会
    // 撞上旧身份被归属守卫当过期丢弃且不会重发，开关恒禁用（真机不会——host
    // 只在 webview 按新 workdir 重拉后才回包）。重拉本身即「已切项目」的信号。
    await expect.poll(() => projectSettingsRequests(webviewPage)).toBe(2);
    await injector.simulateExtensionMessage("projectSettings", {
      workdir: DIR_B,
      enabledPlugins: {},
    });
    const sdd = sddSwitch(webviewPage);
    await expect(sdd).toBeEnabled();
    await injector.clearMessageLog();

    await webviewPage
      .locator('.settings-switch:has(input[aria-label="启用 SDD 插件"])')
      .click();

    await expect
      .poll(async () =>
        webviewPage.evaluate(() =>
          (
            (
              window as unknown as { getTestMessages?: () => unknown[] }
            ).getTestMessages?.() ?? []
          ).find(
            (m) =>
              (m as { command?: string }).command === "setBuiltinPluginEnabled",
          ),
        ),
      )
      .toMatchObject({
        command: "setBuiltinPluginEnabled",
        pluginId: "sdd@builtin",
        enabled: true,
        scope: "project",
      });
  });

  test("个性化 → 项目级 AGENTS.md：关闭重开设置后按当前项目重读，不残留上一项目内容", async ({
    webviewPage,
  }) => {
    const injector = await setupFocusedOnA(webviewPage);

    // 第一次打开：项目 A。项目级 tab 请求 A 的文件
    await openSettings(webviewPage);
    await webviewPage
      .locator(".settings-nav-item", { hasText: "个性化" })
      .click();
    await webviewPage.getByRole("tab", { name: "项目级" }).click();

    await expect
      .poll(async () =>
        webviewPage.evaluate(() =>
          (
            (
              window as unknown as { getTestMessages?: () => unknown[] }
            ).getTestMessages?.() ?? []
          ).find(
            (m) =>
              (m as { command?: string }).command === "getAgentsContent" &&
              (m as { scope?: string }).scope === "project",
          ),
        ),
      )
      .toMatchObject({
        command: "getAgentsContent",
        scope: "project",
        workdir: DIR_A,
      });

    await injector.simulateExtensionMessage("agentsContentResponse", {
      scope: "project",
      content: "# 项目 A 规范\n",
    });
    await expect(webviewPage.getByLabel("项目级 AGENTS.md 内容")).toHaveValue(
      "# 项目 A 规范\n",
    );

    // 关闭设置 → 聚焦切到项目 B（缓存须在每次打开时重置，否则继续显示 A）
    await closeSettings(webviewPage);
    await focusProjectB(injector);
    await injector.clearMessageLog();

    await openSettings(webviewPage);
    await webviewPage
      .locator(".settings-nav-item", { hasText: "个性化" })
      .click();
    await webviewPage.getByRole("tab", { name: "项目级" }).click();

    // 重开后按当前项目 B 请求，workdir 归属键必须是 B
    await expect
      .poll(async () =>
        webviewPage.evaluate(() =>
          (
            (
              window as unknown as { getTestMessages?: () => unknown[] }
            ).getTestMessages?.() ?? []
          ).find(
            (m) =>
              (m as { command?: string }).command === "getAgentsContent" &&
              (m as { scope?: string }).scope === "project",
          ),
        ),
      )
      .toMatchObject({
        command: "getAgentsContent",
        scope: "project",
        workdir: DIR_B,
      });

    await injector.simulateExtensionMessage("agentsContentResponse", {
      scope: "project",
      content: "# 项目 B 规范\n",
    });
    // 修复前：编辑器缓存不失效 → 仍显示 A 的内容，断言先红
    await expect(webviewPage.getByLabel("项目级 AGENTS.md 内容")).toHaveValue(
      "# 项目 B 规范\n",
    );
  });
});
