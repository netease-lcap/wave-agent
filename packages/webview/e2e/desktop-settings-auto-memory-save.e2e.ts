import { test, expect } from "./utils/desktopTestHarness.js";
import type { Page } from "@playwright/test";
import { MessageInjector } from "./utils/messageInjector.js";

/**
 * Regression e2e（真浏览器 + 真 chat.js bundle，桌面模式）——「个性化 → 自动记忆
 * 规则」的保存路径：用户改的开关与轮次必须真的离开 webview（#2115「自动记忆开关
 * 不生效」的 webview 侧守护）。
 *
 * #2115 的根因是 `autoMemoryEnabled` / `autoMemoryFrequency` 在 webview 保存 →
 * host → CLI → SDK 链上缺字段、全 optional 编译期不报错。原缺陷落在下游（host→
 * CLI→SDK），webview 这一跳当时是对的；本用例把这一跳钉死，防后续重构（例如
 * PR-2 改成写用户级 settings.json）悄悄把字段丢掉——单测里 mock 掉的东西正是
 * 这里要真跑的部分（真 bundle、真 DOM 交互、真 postMessage）。
 *
 * 分层：host → CLI 的 stdio 透传由补测会话负责；host 落 `~/.wave/settings.json`、
 * SDK 实时重载由 desktop 单测与真 host 层负责（见 agent-config.md「验证分层」）。
 */

const WORKDIR = "/Users/dev/projects/wave-agent";

const accountInfo = {
  isAuthenticated: true,
  user: { id: "user-1", email: "alice@example.com" },
  plan: null,
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
    configurationData: {
      model: "claude-sonnet-4-20250514",
      ...configurationData,
    },
    permissionMode: "default",
    workdir: WORKDIR,
  });
  await injector.simulateExtensionMessage("desktopAccountInfo", accountInfo);
  return injector;
}

async function openPersonalization(page: Page) {
  await page.getByTestId("account-card-hotzone").click();
  await expect(page.getByTestId("more-menu")).toBeVisible();
  await page.getByTestId("more-menu-settings").click();
  await expect(page.locator(".settings-page")).toBeVisible();
  await page.locator(".settings-nav-item", { hasText: "个性化" }).click();
  await expect(
    page.getByRole("heading", { name: "自动记忆规则" }),
  ).toBeVisible();
}

function memorySection(page: Page) {
  return page.locator("section", {
    has: page.getByRole("heading", { name: "自动记忆规则" }),
  });
}

function postedMessage(page: Page, command: string): Promise<unknown> {
  return page.evaluate(
    (expected) =>
      (
        (
          window as unknown as { getTestMessages?: () => unknown[] }
        ).getTestMessages?.() ?? []
      ).find((m) => (m as { command?: string }).command === expected),
    command,
  );
}

test.describe("桌面设置页「个性化 → 自动记忆规则」保存路径", () => {
  test("关掉开关 + 改轮次后保存：updateConfiguration 载荷带出两个字段", async ({
    webviewPage,
  }) => {
    const injector = await bootDesktop(webviewPage, {
      language: "zh-CN",
      autoMemoryEnabled: true,
      autoMemoryFrequency: 1,
    });
    await openPersonalization(webviewPage);
    // 打开设置页会 post getConfiguration（desktopHost 的生效配置回包）；mock 里
    // 无 paneId 的消息会被路由到聚焦 pane，故这里显式回一次 configurationResponse
    // ——它不受 pane 门控，根实例（渲染全页设置页的那一个）据此拿到配置。
    await injector.simulateExtensionMessage("configurationResponse", {
      configurationData: {
        language: "zh-CN",
        autoMemoryEnabled: true,
        autoMemoryFrequency: 1,
      },
    });

    const section = memorySection(webviewPage);
    const toggle = section.locator('input[aria-label="开启自动记忆"]');
    await expect(toggle).toBeChecked();

    // 开关的 checkbox 本体是 opacity:0 的隐藏 input，交互点在样式化的外层
    // .settings-switch（与 settings-project-toggle.e2e.ts 一致）。
    await section
      .locator('.settings-switch:has(input[aria-label="开启自动记忆"])')
      .click();
    await expect(toggle).not.toBeChecked();
    await section.locator('input[aria-label="触发记忆提取会话轮次"]').fill("5");

    await injector.clearMessageLog();
    await section.getByRole("button", { name: "保存" }).click();

    await expect
      .poll(() => postedMessage(webviewPage, "updateConfiguration"))
      .toEqual({
        command: "updateConfiguration",
        // diff 载荷（spec agent-config 场景 8）：只有真正改动过的两个字段上送，
        // 未改的 language 不出现在报文里（省略键 = 不改该键）。
        configurationData: {
          autoMemoryEnabled: false,
          autoMemoryFrequency: 5,
        },
      });

    // 保存路径只落盘 + 回执（PR-2）：不得因保存触发任何会话重建——真 host 若要走
    // 重建会先弹确认框（`desktopRebuildPrompt`）并等用户回执，故「没有确认框、
    // 没有重建回执」在 UI 上就等于「没有重建」；设置页自身仍是保存后的状态。
    await expect(webviewPage.locator(".confirm-dialog")).toHaveCount(0);
    expect(
      await postedMessage(webviewPage, "desktopRebuildDecision"),
    ).toBeUndefined();
    await expect(webviewPage.locator(".settings-page")).toBeVisible();
  });

  test("host 下发的自动记忆偏好如实回填（关闭态/自定义轮次）", async ({
    webviewPage,
  }) => {
    const injector = await bootDesktop(webviewPage, {
      language: "zh-CN",
      autoMemoryEnabled: true,
      autoMemoryFrequency: 1,
    });
    await openPersonalization(webviewPage);

    // host 回发生效配置（例如另一处改动或外部更新）：界面必须跟着走到「关闭 + 7 轮」
    await injector.simulateExtensionMessage("configurationResponse", {
      configurationData: {
        language: "zh-CN",
        autoMemoryEnabled: false,
        autoMemoryFrequency: 7,
      },
    });

    const section = memorySection(webviewPage);
    await expect(
      section.locator('input[aria-label="开启自动记忆"]'),
    ).not.toBeChecked();
    await expect(
      section.locator('input[aria-label="触发记忆提取会话轮次"]'),
    ).toHaveValue("7");
  });
});
