import type { Page } from "@playwright/test";
import { test as desktopTest, expect } from "./utils/desktopTestHarness.js";
import { test as pluginTest } from "./utils/webviewTestHarness.js";
import {
  openSettings,
  sentToHost,
  simulateHostMessage,
} from "./utils/settingsHarness.js";

/**
 * 设置页「桌面端设置」→「系统通知」分组（spec desktop-notifications.md 故事 3
 * 「通知等级与声音可调」）：三类等级 + 提示音。
 *
 * 真源在桌面 host（configStore）：webviewReady 后随其它窗口级状态推一次全量
 * `desktopNotificationSettings`，每次 `setNotificationSettings` 后再推全量。
 * webview 这边：收到快照才渲染分组（场景 7：插件端收不到广播，不渲染）；用户
 * 改动即时上送——等级改动只带**本次改动的类别**（host 侧合并），提示音只带
 * `sound`——并对本实例做乐观更新。
 *
 * 桌面端三条走 chat.js bundle（DesktopApp → root ChatApp 渲染 SettingsPage，
 * 与真机同一条路径）；插件端一条走 settings.js bundle（settings-preview-entry，
 * 宿主是编辑器区的设置 WebviewPanel，从不传桌面端字段）。
 */

const WORKDIR = "/work/wave-agent";
const ALL_BANNER = { permission: "banner", question: "banner", idle: "banner" };

const NOTIFICATION_TESTIDS = [
  "settings-select-notification-permission",
  "settings-select-notification-question",
  "settings-select-notification-idle",
] as const;

/** 桌面端经账户卡片打开全页设置（与 desktop-settings-manage demo 同一条路）。 */
async function openDesktopSettings(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1000, height: 900 });
  // DesktopApp 等 host 推第一次 desktopWorkdirState 才出 shell（单分屏布局）。
  await simulateHostMessage(page, {
    command: "desktopWorkdirState",
    workdir: WORKDIR,
    recentWorkdirs: [WORKDIR],
  });
  // 账户卡片入口：登录态 → 卡片热区 →「更多」→「设置」。
  await simulateHostMessage(page, {
    command: "desktopAccountInfo",
    isAuthenticated: true,
    user: { id: "user-1", email: "alice@example.com" },
    billing: null,
    apiQuota: null,
    update: undefined,
  });
  await expect(page.getByTestId("account-card")).toBeVisible();
  await page.getByTestId("account-card-hotzone").click();
  await page.getByTestId("more-menu-settings").click();
  await expect(page.getByRole("heading", { name: "全局设置" })).toBeVisible();
}

/** 等 host 收到一条与 expected 深相等的 setNotificationSettings（整条比，钉住「只带改动字段」）。 */
async function expectNotificationSet(
  page: Page,
  expected: Record<string, unknown>,
): Promise<void> {
  await expect
    .poll(async () => {
      const messages = await sentToHost(page);
      return messages
        .filter((m) => m.command === "setNotificationSettings")
        .some((m) => {
          // 整条比（去掉 command 后与 expected 深相等）：钉住「只带改动字段」。
          const rest: Record<string, unknown> = { ...m };
          delete rest.command;
          return JSON.stringify(rest) === JSON.stringify(expected);
        });
    })
    .toBe(true);
}

desktopTest.describe(
  "桌面端设置「系统通知」分组（desktop-notifications.md 故事 3）",
  () => {
    desktopTest(
      "host 推全量快照后：分组可见，三类默认「弹窗提醒」、提示音开（场景 1 / 5）",
      async ({ webviewPage }) => {
        await openDesktopSettings(webviewPage);
        await expect(
          webviewPage.getByText("系统通知", { exact: true }),
        ).toHaveCount(0);

        // 窗口级广播（未打 paneId）：webviewReady 后 host 主动推的那一份。
        await simulateHostMessage(webviewPage, {
          command: "desktopNotificationSettings",
          levels: ALL_BANNER,
          sound: true,
        });

        await expect(
          webviewPage.getByText("系统通知", { exact: true }),
        ).toBeVisible();
        for (const testId of NOTIFICATION_TESTIDS) {
          await expect(webviewPage.getByTestId(testId)).toHaveText("弹窗提醒");
        }
        await expect(
          webviewPage.getByTestId("settings-switch-notification-sound"),
        ).toBeChecked();
        // 行标题 + 用途说明各就各位（三行的顺序固定：权限请求 / 回答提问 / 回合完成）。
        await expect(
          webviewPage.locator(".settings-row-copy h3", { hasText: "权限请求" }),
        ).toBeVisible();
        await expect(
          webviewPage.locator(".settings-row-copy h3", { hasText: "回答提问" }),
        ).toBeVisible();
        await expect(
          webviewPage.locator(".settings-row-copy h3", { hasText: "回合完成" }),
        ).toBeVisible();
        // 「仅标记」文案不替下一个故事承诺任务栏/Dock 标记。
        await webviewPage
          .getByTestId("settings-select-notification-idle")
          .click();
        await expect(
          webviewPage.getByTestId("settings-select-notification-idle-menu"),
        ).toContainText("仅标记（不弹窗）");
        await webviewPage.keyboard.press("Escape");
        await expect(
          webviewPage.getByTestId("settings-select-notification-idle-menu"),
        ).toHaveCount(0);
        // 只是看了一眼菜单，不该有任何上送。
        const sent = await sentToHost(webviewPage);
        expect(
          sent.filter((m) => m.command === "setNotificationSettings"),
        ).toEqual([]);
      },
    );

    desktopTest(
      "「回合完成」切到「关闭」→ 只带改动类别的 levels 上送；host 回全量广播后仍为「关闭」（场景 4 / 6）",
      async ({ webviewPage }) => {
        await openDesktopSettings(webviewPage);
        await simulateHostMessage(webviewPage, {
          command: "desktopNotificationSettings",
          levels: ALL_BANNER,
          sound: true,
        });
        await expect(
          webviewPage.getByTestId("settings-select-notification-idle"),
        ).toHaveText("弹窗提醒");

        await webviewPage
          .getByTestId("settings-select-notification-idle")
          .click();
        await webviewPage
          .getByTestId("settings-select-notification-idle-option-off")
          .click();

        // webview → host：载荷只带本次改动的类别（其余两类不出现）。
        await expectNotificationSet(webviewPage, { levels: { idle: "off" } });
        // 乐观更新：不等 host 回包，触发器已显示新值；其余两行不受影响。
        await expect(
          webviewPage.getByTestId("settings-select-notification-idle"),
        ).toHaveText("关闭");
        await expect(
          webviewPage.getByTestId("settings-select-notification-permission"),
        ).toHaveText("弹窗提醒");
        await expect(
          webviewPage.getByTestId("settings-select-notification-question"),
        ).toHaveText("弹窗提醒");

        // host 持久化后回全量广播（幂等）：显示值不变。
        await simulateHostMessage(webviewPage, {
          command: "desktopNotificationSettings",
          levels: { ...ALL_BANNER, idle: "off" },
          sound: true,
        });
        await expect(
          webviewPage.getByTestId("settings-select-notification-idle"),
        ).toHaveText("关闭");
        await expect(
          webviewPage.getByTestId("settings-select-notification-permission"),
        ).toHaveText("弹窗提醒");
      },
    );

    desktopTest(
      "关提示音 → 只带 sound 的上送，开关即时为关（场景 5 / 6）",
      async ({ webviewPage }) => {
        await openDesktopSettings(webviewPage);
        await simulateHostMessage(webviewPage, {
          command: "desktopNotificationSettings",
          levels: ALL_BANNER,
          sound: true,
        });
        const soundSwitch = webviewPage.getByTestId(
          "settings-switch-notification-sound",
        );
        await expect(soundSwitch).toBeChecked();

        // input 本体 opacity:0 / width:0（.settings-switch input），点可见的外壳 label；
        // 状态断言仍打在 input 上（与 settings-project-toggle 同一手法）。
        await webviewPage
          .locator(".settings-switch", { has: soundSwitch })
          .click();

        // webview → host：不带 levels（提示音改动不碰等级）。
        await expectNotificationSet(webviewPage, { sound: false });
        await expect(soundSwitch).not.toBeChecked();

        // host 回全量广播：仍为关。
        await simulateHostMessage(webviewPage, {
          command: "desktopNotificationSettings",
          levels: ALL_BANNER,
          sound: false,
        });
        await expect(soundSwitch).not.toBeChecked();
      },
    );

    desktopTest(
      "坏载荷（sound 不是 boolean）整条丢弃，分组不渲染",
      async ({ webviewPage }) => {
        await openDesktopSettings(webviewPage);
        await simulateHostMessage(webviewPage, {
          command: "desktopNotificationSettings",
          levels: ALL_BANNER,
          sound: "yes",
        });
        await expect(
          webviewPage.getByText("系统通知", { exact: true }),
        ).toHaveCount(0);
        for (const testId of NOTIFICATION_TESTIDS) {
          await expect(webviewPage.getByTestId(testId)).toHaveCount(0);
        }
      },
    );
  },
);

pluginTest.describe("插件端设置页不渲染「系统通知」分组（场景 7）", () => {
  pluginTest(
    "settings.js bundle（宿主不传桌面端字段）：分组与四个控件都不出现",
    async ({ webviewPage }) => {
      // settings-preview-entry 从不传 themeSource / updateChannel /
      // notificationLevels——本用例钉的是「系统通知」分组不出现。
      await openSettings(webviewPage);
      await expect(
        webviewPage.getByRole("heading", { name: "全局设置" }),
      ).toBeVisible();

      await expect(
        webviewPage.getByText("系统通知", { exact: true }),
      ).toHaveCount(0);
      for (const testId of NOTIFICATION_TESTIDS) {
        await expect(webviewPage.getByTestId(testId)).toHaveCount(0);
      }
      await expect(
        webviewPage.getByTestId("settings-switch-notification-sound"),
      ).toHaveCount(0);
    },
  );
});
