import { test, expect } from "./utils/desktopTestHarness.js";
import type { Page } from "@playwright/test";
import { MessageInjector } from "./utils/messageInjector.js";

/**
 * e2e（真浏览器 + 真 chat.js bundle，桌面模式）——桌面端「全局设置」里**不该**
 * 出现补全两行。
 *
 * 出处：spec ui/code-completion.md 边界情况「补全设置行的宿主范围」与
 * desktop-settings.md 场景 3（补全模型/补全开关不在本端展示）。
 *
 * 设置页是四端**共用**实现（IDE 宿主经 settings.js、桌面端经 chat.js 渲染同一份
 * SettingsPage），因此门禁一旦漏掉桌面端，用户会在一个没有代码编辑器、永远不会
 * 触发补全的应用里看到一个补全开关——「承诺一个不会发生的功能」。单测
 * （settingsGlobal.test.tsx）用 `window.waveHostType` 覆盖了判定分支，本用例守住
 * 真 bundle + 真桌面宿主标记下的实际呈现。（原先这里还断言桌面端不发起
 * `getConfiguredModels`；底栏模型选择器上线后对话面板自己会拉这份清单，那条
 * 断言随之失效。）
 */

const WORKDIR = "/Users/dev/projects/wave-agent";

const accountInfo = {
  isAuthenticated: true,
  user: { id: "user-1", email: "alice@example.com" },
  billing: null,
  apiQuota: null,
};

async function bootDesktop(
  page: Page,
  configurationData: Record<string, unknown>,
) {
  const injector = new MessageInjector(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await injector.simulateExtensionMessage("desktopWorkdirState", {
    workdir: WORKDIR,
    recentWorkdirs: [WORKDIR],
  });
  await injector.waitForChatAppReady();
  await injector.simulateExtensionMessage("setInitialState", {
    messages: [],
    isStreaming: false,
    sessions: [],
    isAuthenticated: true,
    configurationData,
    permissionMode: "default",
    workdir: WORKDIR,
  });
  await injector.simulateExtensionMessage("desktopAccountInfo", accountInfo);
  return injector;
}

async function openGlobalSettings(page: Page) {
  await page.getByTestId("account-card-hotzone").click();
  await expect(page.getByTestId("more-menu")).toBeVisible();
  await page.getByTestId("more-menu-settings").click();
  await expect(page.locator(".settings-page")).toBeVisible();
  await page.locator(".settings-nav-item", { hasText: "全局设置" }).click();
  await expect(
    page.getByRole("heading", { name: "AI 回复语言" }),
  ).toBeVisible();
}

test.describe("桌面端设置页不含补全两行（宿主能力门禁）", () => {
  test("「全局设置」渲染语言与桌面端设置区块，但不渲染代码补全/补全模型", async ({
    webviewPage,
  }) => {
    const injector = await bootDesktop(webviewPage, {
      language: "zh-CN",
      // 即使宿主回包里带着这两个键（settings.json 里手改过），桌面端也不该把它们
      // 渲染成可编辑控件——门禁是宿主能力位，不是「文件里有没有这个键」。
      completionModel: "qwen2.5-coder",
      completionEnabled: false,
    });
    await openGlobalSettings(webviewPage);
    await injector.simulateExtensionMessage("configurationResponse", {
      configurationData: {
        language: "zh-CN",
        completionModel: "qwen2.5-coder",
        completionEnabled: false,
      },
    });

    // 同卡片其它行照常渲染：门禁只摘这两行，不是整卡消失
    await expect(
      webviewPage.getByRole("heading", { name: "AI 回复语言" }),
    ).toBeVisible();
    await expect(
      webviewPage.getByRole("heading", { name: "上下文长度" }),
    ).toBeVisible();
    // 桌面端独有的本地偏好区块（主题/Beta）与补全无关，必须还在
    await expect(
      webviewPage.getByRole("heading", { name: "主题" }),
    ).toBeVisible();

    await expect(
      webviewPage.getByRole("heading", { name: "代码补全" }),
    ).toHaveCount(0);
    await expect(
      webviewPage.getByRole("heading", { name: "补全模型" }),
    ).toHaveCount(0);
    await expect(
      webviewPage.locator('input[aria-label="代码补全"]'),
    ).toHaveCount(0);
    await expect(
      webviewPage.locator('select[aria-label="补全模型"]'),
    ).toHaveCount(0);
  });
});
