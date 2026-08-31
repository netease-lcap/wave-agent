import { test, expect } from "../e2e/utils/desktopTestHarness.js";
import { MessageInjector } from "../e2e/utils/messageInjector.js";
import { MockDataGenerator } from "../e2e/fixtures/mockData.js";
import { screenshotWebp } from "../e2e/utils/screenshot.js";

/**
 * Batch 2 desktop features (spec desktop-app.md 批次 2): screenshots for the
 * settings full-page (全局设置 / 个性化), session status board, context
 * compress button, and account card (plan usage + API quota). The shared
 * webview bundle must be rebuilt first (node esbuild.config.mjs) or these
 * shots capture the old UI.
 */
const DIR_A = "/Users/dev/projects/wave-agent";
const DIR_B = "/Users/dev/projects/web-dashboard";

const initialState = {
  messages: [],
  isStreaming: false,
  sessions: [],
  isAuthenticated: true,
  configurationData: {
    baseURL: "https://api.anthropic.com/v1",
    model: "claude-sonnet-4-20250514",
    fastModel: "claude-haiku-4-20250514",
  },
  permissionMode: "default",
};

/** Single-pane desktop layout with one conversation in progress. */
async function setupSinglePane(injector: MessageInjector) {
  await injector.simulateExtensionMessage("desktopWorkdirState", {
    workdir: DIR_A,
    recentWorkdirs: [DIR_A, DIR_B],
  });
  await injector.waitForChatAppReady();
  await injector.simulateExtensionMessage("setInitialState", initialState);
  await injector.updateMessages([
    MockDataGenerator.createUserMessage("帮我修复登录页的样式问题", "msg-u1"),
    MockDataGenerator.createAssistantMessage(
      "我先看一下登录页组件的样式文件，找出对齐问题的原因。",
      "msg-a1",
    ),
  ]);
}

test.describe("Desktop batch 2 feature screenshots", () => {
  test("settings / session board / compress / account card", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 1000, height: 720 });
    await setupSinglePane(injector);

    // 1. 上下文压缩按钮：host 推送 contextUsage 后输入框工具栏显示
    //    圆环进度 + 百分比数字（「64%」，完整文案在 aria-label）。
    await injector.simulateExtensionMessage("contextUsage", { percent: 64 });
    await expect(webviewPage.locator(".compress-context-button")).toBeVisible();
    await expect(webviewPage.locator(".compress-context-button")).toContainText(
      "64%",
    );
    await expect(
      webviewPage.locator(".compress-context-button"),
    ).toHaveAttribute("aria-label", "压缩上下文，已使用 64%");
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-compress-button.webp",
    );

    // 2. 账户卡片：注入套餐用量 + API 额度（登录态；apiQuota 用团队余额
    //    模式 limit:null，显示本人累计消耗金额），点击卡片热区展开用量弹窗。
    await injector.simulateExtensionMessage("desktopAccountInfo", {
      isAuthenticated: true,
      user: { id: "user-1", email: "alice@example.com" },
      plan: { monthlyQuota: 100, months: 12, used: 240 },
      apiQuota: { limit: null, used: 1153.14 },
      update: undefined,
    });
    await expect(webviewPage.getByTestId("account-card")).toBeVisible();
    await webviewPage.getByTestId("account-card-hotzone").click();
    await expect(webviewPage.getByText("套餐用量")).toBeVisible();
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-account-card.webp",
    );
    // 收起用量弹窗（点击卡片外空白）再进设置页。
    await webviewPage.locator(".desktop-chat-main").click({
      position: { x: 20, y: 20 },
    });
    await expect(webviewPage.getByText("套餐用量")).toBeHidden();

    // 3. 设置页 - 全局设置：账户卡片「更多」→ 设置 → 全页设置。
    await webviewPage.getByTestId("account-card-more").click();
    await webviewPage.getByTestId("more-menu-settings").click();
    await expect(
      webviewPage.getByRole("heading", { name: "全局设置" }),
    ).toBeVisible();
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-settings-global.webp",
    );

    // 4. 设置页 - 个性化：AGENTS.md 编辑器 + 自动记忆规则。
    await webviewPage.getByRole("button", { name: "个性化" }).click();
    await expect(
      webviewPage.getByRole("heading", { name: "AGENTS.md" }),
    ).toBeVisible();
    await expect(
      webviewPage.getByRole("heading", { name: "自动记忆规则" }),
    ).toBeVisible();
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-settings-personalization.webp",
    );

    // 5. 会话状态看板：返回设置页 → 点侧边栏「活动」→ 注入会话树，
    //    三列展示（等待中 / 运行中 / 已完成）。
    await webviewPage.locator(".settings-back").click();
    await webviewPage.getByTestId("desktop-sidebar-activity").click();
    await injector.simulateExtensionMessage("desktopSessionTree", {
      groups: [
        {
          host: "local",
          workdir: DIR_A,
          sessions: [
            {
              sessionId: "s-done",
              title: "修复登录页样式",
              lastActiveAt: 1782000000000,
              hasWorktree: false,
              running: false,
            },
            {
              sessionId: "s-running",
              title: "重构支付模块",
              lastActiveAt: 1782000100000,
              hasWorktree: true,
              running: true,
            },
            {
              sessionId: "s-waiting",
              title: "审查分布式事务竞态",
              lastActiveAt: 1782000200000,
              hasWorktree: false,
              running: false,
              waitingConfirmation: true,
            },
          ],
        },
        {
          host: "local",
          workdir: DIR_B,
          sessions: [
            {
              sessionId: "s-board",
              title: "搭建订单管理后台",
              lastActiveAt: 1782000300000,
              hasWorktree: false,
              running: false,
            },
          ],
        },
      ],
    });
    await expect(webviewPage.getByTestId("session-board")).toBeVisible();
    await expect(webviewPage.getByText("等待中")).toBeVisible();
    await expect(webviewPage.getByText("运行中")).toBeVisible();
    await expect(webviewPage.getByText("已完成")).toBeVisible();
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-session-board.webp",
    );
  });
});
