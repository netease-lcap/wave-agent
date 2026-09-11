import { test, expect } from "../e2e/utils/desktopTestHarness.js";
import type { Page } from "@playwright/test";
import { seedSidebarSessions } from "./sidebarSeed.js";
import { MessageInjector } from "../e2e/utils/messageInjector.js";
import { MockDataGenerator } from "../e2e/fixtures/mockData.js";
import {
  screenshotWebp,
  elementScreenshotWebp,
} from "../e2e/utils/screenshot.js";

/**
 * Batch 2 desktop features (spec desktop-account-and-settings.md 设置页面/上下文
 * 用量/账户卡片 + desktop-sessions.md 会话状态看板): screenshots for the
 * settings full-page (全局设置 / 个性化), session status board, context
 * usage indicator, and account card (plan usage + API quota). The shared
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
  permissionMode: "default",
};

/**
 * 用户偏好 / 窗口级配置下发（真宿主 = desktopHost.pushAppLevelState 的
 * configurationResponse）：桌面端设置页由 root 实例渲染，而 root 在分屏 rows
 * 可见时不消费带 paneId 的消息，因此该回包必须走窗口级通道才能在任何时机到达
 * root（harness 的 globalCommands 已与真宿主对齐）。
 */
async function pushConfiguration(
  injector: MessageInjector,
  configurationData: Record<string, unknown>,
) {
  await injector.simulateExtensionMessage("configurationResponse", {
    configurationData,
  });
}

/** 登录态账户卡片（设置页入口=卡片热区菜单）+ 企业版服务地址。 */
async function signInAccountCard(injector: MessageInjector) {
  await injector.simulateExtensionMessage("desktopAccountInfo", {
    isAuthenticated: true,
    user: { id: "user-1", email: "alice@example.com" },
    plan: { monthlyQuota: 100, months: 12, used: 240 },
    apiQuota: { limit: null, used: 1153.14 },
    update: undefined,
  });
  // 服务地址来自 auth 域的 SDK resolve 值（宿主经 authStatusResponse 转发）；
  // 缺它时设置页「接收 Beta 版更新」开关会置灰显示「登录后可接收测试版更新」，
  // 与截图里已登录的账户卡片自相矛盾。
  await injector.simulateExtensionMessage("authStatusResponse", {
    isAuthenticated: true,
    user: { id: "user-1", email: "alice@example.com" },
    serverUrl: "https://codechat.codewave.163.com",
  });
}

/** 从账户卡片菜单打开全页设置页。 */
async function openSettingsPage(webviewPage: Page) {
  await webviewPage.getByTestId("account-card-hotzone").click();
  await webviewPage.getByTestId("more-menu-settings").click();
  await expect(
    webviewPage.getByRole("heading", { name: "全局设置" }),
  ).toBeVisible();
}

/** Single-pane desktop layout with one conversation in progress. */
async function setupSinglePane(injector: MessageInjector) {
  await injector.simulateExtensionMessage("desktopWorkdirState", {
    workdir: DIR_A,
    recentWorkdirs: [DIR_A, DIR_B],
  });
  await injector.waitForChatAppReady();
  await seedSidebarSessions(injector, DIR_A, [
    { sessionId: "s-b2-1", title: "修复登录页样式问题" },
    {
      sessionId: "s-b2-2",
      title: "重构支付模块方法签名",
      hasWorktree: true,
    },
    {
      sessionId: "s-b2-3",
      title: "评审数据库迁移脚本",
      waitingConfirmation: true,
    },
  ]);
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
  test("settings / session board / usage indicator / account card", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 1000, height: 720 });
    await setupSinglePane(injector);

    // 1. 上下文用量指示器：host 推送 contextUsage 后输入框工具栏显示
    //    圆环进度 + 百分比数字（「64%」，说明在 aria-label/title）。
    await injector.simulateExtensionMessage("contextUsage", { percent: 64 });
    await expect(webviewPage.locator(".compress-context-button")).toBeVisible();
    await expect(webviewPage.locator(".compress-context-button")).toContainText(
      "64%",
    );
    await expect(
      webviewPage.locator(".compress-context-button"),
    ).toHaveAttribute("aria-label", "已使用 64%");
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-compress-button.webp",
    );

    // 2. 账户卡片（v3）：注入套餐用量 + API 额度（登录态；apiQuota 用团队余额
    //    模式 limit:null，显示本人累计消耗金额）。用量概要常驻卡片顶部，无需
    //    点击展开。
    await signInAccountCard(injector);
    await expect(webviewPage.getByTestId("account-card")).toBeVisible();
    await expect(webviewPage.getByText("套餐用量")).toBeVisible();
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-account-card.webp",
    );

    // 3. 设置页 - 全局设置：个人信息行热区 → 更多菜单 → 设置 → 全页设置。
    //    先下发用户偏好（真源 = 会话进程的用户级 settings.json）：常规配置态，
    //    来源都是用户文件，因此没有来源说明、控件都可编辑。
    await pushConfiguration(injector, {
      language: "zh-CN",
      contextLength: 200,
      autoMemoryEnabled: true,
      autoMemoryFrequency: 1,
      preferenceSources: {
        language: "user",
        contextLength: "user",
        autoMemoryEnabled: "user",
        autoMemoryFrequency: "user",
      },
    });
    await openSettingsPage(webviewPage);
    await expect(webviewPage.getByLabel("AI 回复语言")).toHaveValue("zh-CN");
    await expect(webviewPage.getByLabel("上下文长度")).toHaveValue("200");
    // 截图必须截到两行控件（只断言存在会漏掉「渲染了但在视口外」的截图）
    await expect(webviewPage.getByLabel("AI 回复语言")).toBeInViewport();
    await expect(webviewPage.getByLabel("上下文长度")).toBeInViewport();
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-settings-global.webp",
    );

    // 3b. 服务端配置区块（只读展示服务端下发的托管配置原文）：三个区块已超出
    //     窗口高度，整页截图切在 JSON 中间，故另出一张区块特写（docs/desktop.md
    //     6.2 引用）。harness 的 mock host 会回一份代表性下发内容。
    const serverConfigSection = webviewPage
      .locator(".settings-section")
      .filter({ hasText: "服务端配置" });
    await expect(
      serverConfigSection.getByTestId("settings-managed-json"),
    ).toBeVisible();
    await elementScreenshotWebp(
      serverConfigSection,
      "../../docs/public/screenshots/desktop-settings-managed.webp",
    );

    // 4. 设置页 - 个性化：AGENTS.md 编辑器 + 自动记忆规则。
    await webviewPage.getByRole("button", { name: "个性化" }).click();
    await expect(
      webviewPage.getByRole("heading", { name: "AGENTS.md" }),
    ).toBeVisible();
    await expect(
      webviewPage.getByRole("heading", { name: "自动记忆规则" }),
    ).toBeVisible();
    await expect(webviewPage.getByLabel("开启自动记忆")).toBeChecked();
    await expect(webviewPage.getByLabel("触发记忆提取会话轮次")).toHaveValue(
      "1",
    );
    await expect(
      webviewPage.getByLabel("触发记忆提取会话轮次"),
    ).toBeInViewport();
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

  /**
   * spec core/agent-config.md「IDE 插件配置入口」场景 7–9：设置页的「未设置态」
   * 与被更高层覆盖时的「生效值 + 来源」呈现。两张截图分别对应：
   *
   * - 未设置态：文件里没有这些键（系统环境也没有）→ 语言下拉首项「未设置
   *   （默认：中文）」、上下文长度留空 + 灰字占位符；
   * - 生效值与来源：语言由组织配置下发（置灰 + 「由组织配置管理」）、上下文
   *   长度来自系统环境变量（显示生效值 + 来源说明、仍可编辑）。
   */
  test("settings: 未设置态与「生效值 + 来源」", async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 1000, height: 720 });
    await setupSinglePane(injector);
    await signInAccountCard(injector);

    // 1. 未设置态：settings.json 里没有用户偏好键。
    await pushConfiguration(injector, {});
    await openSettingsPage(webviewPage);
    await expect(webviewPage.getByLabel("AI 回复语言")).toHaveValue("");
    await expect(webviewPage.getByLabel("上下文长度")).toHaveValue("");
    await expect(webviewPage.getByLabel("上下文长度")).toHaveAttribute(
      "placeholder",
      "跟随模型配置（默认 200K）",
    );
    await expect(webviewPage.getByLabel("上下文长度")).toBeInViewport();
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-settings-unset.webp",
    );

    // 2. 生效值与来源：语言来自组织配置（不可改）、上下文长度来自系统环境变量
    //    （可改，保存即写用户文件覆盖环境值）。
    await pushConfiguration(injector, {
      language: "en-US",
      contextLength: 64,
      preferenceSources: { language: "remote", contextLength: "env" },
    });
    await expect(webviewPage.getByLabel("AI 回复语言")).toHaveValue("en-US");
    await expect(webviewPage.getByLabel("AI 回复语言")).toBeDisabled();
    await expect(webviewPage.getByLabel("上下文长度")).toHaveValue("64");
    await expect(webviewPage.getByLabel("上下文长度")).toBeEnabled();
    await expect(
      webviewPage.locator(".settings-row", { hasText: "AI 回复语言" }),
    ).toContainText("由组织配置管理");
    await expect(
      webviewPage.locator(".settings-row", { hasText: "上下文长度" }),
    ).toContainText("当前值来自系统环境变量；保存后以本页设置为准");
    await expect(
      webviewPage.locator(".settings-row", { hasText: "AI 回复语言" }),
    ).toBeInViewport();
    await expect(
      webviewPage.locator(".settings-row", { hasText: "上下文长度" }),
    ).toBeInViewport();
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-settings-source.webp",
    );
  });

  /**
   * spec core/agent-config.md「配置变更的构造期副作用与重建」场景 4–6：插件变更
   * （安装/卸载/启用/禁用/更新、内置 SDD 开关）落盘后桌面端弹确认框，只决定生效
   * 时机——两按钮、无「取消」（Esc 等同「稍后重启」）。
   */
  test("settings: 插件变更重建确认框", async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 1000, height: 720 });
    await setupSinglePane(injector);
    await signInAccountCard(injector);
    await pushConfiguration(injector, {
      language: "zh-CN",
      contextLength: 200,
    });
    // 插件变更发生在「项目设置」（内置 SDD 开关）等视图，确认框盖在设置页上。
    await openSettingsPage(webviewPage);
    await webviewPage.getByRole("button", { name: "项目设置" }).click();
    await expect(
      webviewPage.getByRole("heading", { name: "项目设置" }),
    ).toBeVisible();

    await injector.simulateExtensionMessage("desktopRebuildPrompt", {
      total: 3,
      busy: 1,
    });
    const dialog = webviewPage.locator(".confirm-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("插件变更需要重启对话才能生效。");
    await expect(dialog).toContainText(
      "将重启 3 个对话，其中 1 个正在执行任务暂不重启。",
    );
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-settings-rebuild-prompt.webp",
    );
  });
});
