import { test, expect } from "../e2e/utils/webviewTestHarness.js";
import { MessageInjector } from "../e2e/utils/messageInjector.js";
import { MockDataGenerator } from "../e2e/fixtures/mockData.js";
import { screenshotWebp } from "../e2e/utils/screenshot.js";
import {
  openSettings,
  simulateHostMessage,
} from "../e2e/utils/settingsHarness.js";
import fs from "node:fs";
import path from "node:path";
import {
  BASH_TOOL_NAME,
  EXIT_PLAN_MODE_TOOL_NAME,
  type Message,
} from "wave-agent-sdk";
import type { Page } from "@playwright/test";

/**
 * Web 端（远控 Web 页）手机布局截图 —— docs/web.md 用。
 *
 * 远控页是共享 webview bundle 的第五个宿主，靠两样东西与 IDE 宿主区分：
 * `window.waveRemotePage = true`（`isRemotePageHost()` 读它，决定顶栏的「会话 /
 * 切换电脑」入口、会话整页列表、计划正文内联审批等）与 `<html data-remote-page>`
 * （`styles/remote-page.css` 的手机档样式全部挂在这个属性下）。测试 harness 造的是
 * IDE 宿主页面，所以这里两样都自己补上，再用 iPhone 竖屏尺寸截图。
 */

const PHONE = { width: 390, height: 844 };
const DIR_A = "/Users/dev/projects/wave-agent";
const DIR_B = "/Users/dev/projects/web-dashboard";
const DIR_C = "/Users/dev/projects/payment-service";

const now = Date.now();
const at = (msAgo: number) => new Date(now - msAgo).toISOString();

const sessions = [
  {
    id: "s-web-1",
    customTitle: "修复登录页样式对齐",
    workdir: DIR_A,
    lastActiveAt: at(60_000),
  },
  {
    id: "s-web-2",
    firstMessage: "重构订单状态流转，把状态机抽成独立模块并补测试",
    workdir: DIR_B,
    lastActiveAt: at(25 * 60_000),
  },
  {
    id: "s-web-3",
    customTitle: "评审支付回调幂等逻辑",
    workdir: DIR_C,
    lastActiveAt: at(26 * 3600_000),
  },
];

/** iPhone 竖屏视口（2× 像素密度，截图进文档后在视网膜屏上不糊）。 */
async function emulatePhoneViewport(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: PHONE.width,
    height: PHONE.height,
    deviceScaleFactor: 2,
    mobile: true,
  });
}

/** 手机视口 + 远控页宿主身份（harness 只造 IDE 宿主页面）。 */
async function emulateRemotePhone(page: Page): Promise<void> {
  await emulatePhoneViewport(page);
  await page.evaluate(() => {
    // 这个标记由页面 shim 打（remote/shim.js），demo 的 tsconfig 看不到那份声明，
    // 用 Object.assign 赋值避免为此在 demo 侧再声明一遍全局类型。
    Object.assign(window, { waveRemotePage: true });
    document.documentElement.dataset.remotePage = "1";
    document.documentElement.dataset.theme = "dark";
  });
}

/** 远控页冷启动快照：会话、状态点、当前会话一次给全。 */
async function seedRemoteState(injector: MessageInjector) {
  await injector.simulateExtensionMessage("setInitialState", {
    messages: [],
    isStreaming: false,
    sessions,
    currentSession: sessions[0],
    // 顶栏标题由 `message.session` 落进 `state.currentSession`（`getSessionTitle`
    // 读的是它，不是 `currentSession` 这个键）。
    session: sessions[0],
    sessionStatus: {
      running: ["s-web-1"],
      waiting: ["s-web-3"],
      background: ["s-web-2"],
      worktrees: [],
    },
    isAuthenticated: true,
    permissionMode: "default",
    workdir: DIR_A,
  });
  await injector.waitForChatAppReady();
}

const conversation: Message[] = [
  MockDataGenerator.createUserMessage(
    "登录页在小屏幕上按钮错位了，先看看是什么原因",
    "msg-web-u1",
  ),
  {
    id: "msg-web-a1",
    role: "assistant",
    timestamp: at(4 * 60_000),
    blocks: [
      {
        type: "text",
        content:
          "登录表单在 375px 下用的是两列布局，容器宽度不够导致按钮被挤出。我先改成断点内单列，再跑一遍视觉验证。",
      },
      {
        type: "tool",
        name: BASH_TOOL_NAME,
        stage: "end",
        parameters: JSON.stringify({
          command: "pnpm -F wave-webview test:demo -- login",
        }),
        result: "12 passed (8.4s)",
      },
      {
        type: "text",
        content:
          "改完了：375 / 768 两档都过。改动集中在表单容器与按钮两处，没有动其他页面。",
      },
    ],
  },
  MockDataGenerator.createUserMessage(
    "顺手把这两档视觉回归接到 CI 上",
    "msg-web-u2",
  ),
];

test.describe("Web 端（远控页）手机截图", () => {
  test("对话页：顶栏会话入口 + 流式对话", async ({ webviewPage }) => {
    await emulateRemotePhone(webviewPage);
    const injector = new MessageInjector(webviewPage);
    await seedRemoteState(injector);
    await injector.updateMessages(conversation);
    await expect(webviewPage.getByTestId("session-switch-btn")).toBeVisible();
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/web-chat.webp",
    );
  });

  test("会话列表整页：状态点与行级动作", async ({ webviewPage }) => {
    await emulateRemotePhone(webviewPage);
    const injector = new MessageInjector(webviewPage);
    await seedRemoteState(injector);
    await injector.updateMessages(conversation);
    await webviewPage.getByTestId("session-switch-btn").click();
    await expect(
      webviewPage.getByTestId("remote-session-row-s-web-3"),
    ).toBeVisible();
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/web-session-list.webp",
    );
  });

  test("审批：从手机批一条命令", async ({ webviewPage }) => {
    await emulateRemotePhone(webviewPage);
    const injector = new MessageInjector(webviewPage);
    await seedRemoteState(injector);
    await injector.updateMessages(conversation);
    await injector.simulateExtensionMessage("showConfirmation", {
      confirmationId: "web-confirm-1",
      toolName: BASH_TOOL_NAME,
      confirmationType: "命令待执行",
      toolInput: {
        command: "git push origin fix/login-alignment",
        description: "推送修复分支",
      },
    });
    await expect(webviewPage.getByText("git push origin")).toBeVisible();
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/web-approval.webp",
    );
  });

  test("计划审批：计划正文内联在对话框里", async ({ webviewPage }) => {
    await emulateRemotePhone(webviewPage);
    const injector = new MessageInjector(webviewPage);
    await seedRemoteState(injector);
    await injector.updateMessages(conversation);
    await injector.simulateExtensionMessage("showConfirmation", {
      confirmationId: "web-confirm-plan",
      toolName: EXIT_PLAN_MODE_TOOL_NAME,
      confirmationType: "计划执行确认",
      planContent: [
        "## 登录页响应式修复",
        "",
        "1. `LoginForm.tsx` 容器由固定两列改为断点单列（≤480px）",
        "2. 主按钮改为整行宽度，次级链接下移一行",
        "3. 补 375 / 768 两档回归用例",
      ].join("\n"),
    });
    await expect(webviewPage.getByTestId("plan-content-preview")).toBeVisible();
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/web-plan-approval.webp",
    );
  });

  test("新建会话：选目录与 worktree", async ({ webviewPage }) => {
    await emulateRemotePhone(webviewPage);
    const injector = new MessageInjector(webviewPage);
    await seedRemoteState(injector);
    await injector.updateMessages(conversation);
    await webviewPage.getByTestId("new-session-btn").click();
    await expect(
      webviewPage.getByTestId("remote-new-session-dialog"),
    ).toBeVisible();
    // 点最近目录 → 弹窗拉分支（决定下半区是「分支 + worktree」还是只有目录）。
    // requestId 由弹窗自己分配，回执必须原样带回，否则被当作过期回包丢掉。
    await webviewPage
      .getByTestId("remote-new-session-recent-item")
      .first()
      .click();
    const branchRequest = await webviewPage.evaluate(() =>
      window
        .getTestMessages()
        .filter((m) => m.command === "newSessionListBranches")
        .pop(),
    );
    await injector.simulateExtensionMessage("newSessionBranches", {
      requestId: (branchRequest as { requestId?: string } | undefined)
        ?.requestId,
      // 宿主 `listGitBranches` 的回执形状：一对 {branches, current}（与桌面端
      // `desktopGitBranches` 同一份），不是裸的分支名数组。
      result: { branches: ["main", "fix/login-alignment"], current: "main" },
    });
    await expect(
      webviewPage.getByTestId("remote-new-session-branch-select"),
    ).toBeVisible();
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/web-new-session.webp",
    );
  });

  test("会话行级动作：重命名 / 删除会话", async ({ webviewPage }) => {
    await emulateRemotePhone(webviewPage);
    const injector = new MessageInjector(webviewPage);
    await seedRemoteState(injector);
    await injector.updateMessages(conversation);
    await webviewPage.getByTestId("session-switch-btn").click();
    await webviewPage.getByTestId("remote-session-more-s-web-2").click();
    await expect(
      webviewPage.getByTestId("remote-session-actions"),
    ).toBeVisible();
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/web-session-actions.webp",
    );
  });

  test("更多菜单：通知开关与设置入口", async ({ webviewPage }) => {
    await emulateRemotePhone(webviewPage);
    const injector = new MessageInjector(webviewPage);
    await seedRemoteState(injector);
    await injector.updateMessages(conversation);
    await injector.simulateExtensionMessage("pushState", {
      supported: true,
      subscribed: true,
      needsHomeScreen: false,
    });
    await webviewPage.getByTestId("more-btn").click();
    await expect(webviewPage.locator(".more-menu")).toBeVisible();
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/web-more-menu.webp",
    );
  });

  test("切换电脑：机器列表浮层", async ({ webviewPage }) => {
    await emulatePhoneViewport(webviewPage);
    // 这个浮层由页面 shim 手写 DOM（不在共享 webview 里，`isRemotePageHost()`
    // 分支也照不到它），只能把**真 shim** 装进浏览器里跑一遍。做法：假一个
    // `remote.test` 源，index.html 内联 shim.js，机器列表接口用 route 挡住回桩
    // 数据 —— shim 冷启动没有 `?host=` 时自己就弹这个列表，不需要真实中继。
    const shimSource = fs.readFileSync(
      path.join(process.cwd(), "remote", "shim.js"),
      "utf8",
    );
    const hosts = [
      {
        id: "host-a",
        name: "dev-macbook-pro",
        platform: "darwin",
        online: true,
      },
      { id: "host-b", name: "ci-linux-02", platform: "linux", online: true },
      {
        id: "host-c",
        name: "win-workstation",
        platform: "win32",
        online: false,
      },
    ];
    await webviewPage.route("http://remote.test/**", (route) => {
      const { pathname } = new URL(route.request().url());
      if (pathname === "/api/relay/hosts") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ hosts }),
        });
      }
      if (pathname === "/" || pathname === "/index.html") {
        return route.fulfill({
          status: 200,
          contentType: "text/html; charset=utf-8",
          body:
            `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8" />` +
            `<meta name="viewport" content="width=device-width, initial-scale=1" />` +
            `<style>html,body{margin:0;height:100%;background:#1f1f1f}</style></head><body>` +
            // 有令牌就不再走续期，直接落到「没有通道键 → 自己挑一台机器」
            `<script>try{localStorage.setItem("token","demo-token")}catch(e){}</script>` +
            `<script>${shimSource}</script></body></html>`,
        });
      }
      return route.fulfill({ status: 404, body: "" });
    });
    await webviewPage.goto("http://remote.test/index.html");
    await expect(webviewPage.locator("#remote-machine-picker")).toBeVisible();
    await expect(webviewPage.locator("#remote-machine-list")).toContainText(
      "ci-linux-02",
    );
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/web-machine-picker.webp",
    );
  });

  test("电脑侧开启：页面地址与二维码", async ({ webviewPage }) => {
    // 入口在**电脑**上：桌面端 / IDE 插件的设置页「远程控制」项。手机页自己
    // 不画这个二维码（它本身就是二维码指向的那一端）。
    await openSettings(webviewPage, {
      width: 1000,
      height: 760,
      settingsState: { workdir: DIR_A, nav: "remoteControl" },
    });
    // 视图挂载即轮询 `remoteControl`，回执按 requestId 关联 —— 必须带最新那次。
    const request = await webviewPage.evaluate(() =>
      window
        .getTestMessages()
        .filter((m) => m.command === "remoteControl")
        .pop(),
    );
    await simulateHostMessage(webviewPage, {
      command: "remoteControlResponse",
      requestId: (request as { requestId?: string } | undefined)?.requestId,
      snapshot: {
        state: "online",
        pageUrl:
          "https://codechat.codewave.163.com/remote/?host=7cg4m2xw9pk1qv3b",
      },
    });
    await expect(webviewPage.getByTestId("remote-control-qr")).toBeVisible();
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-remote-control.webp",
    );
  });
});
