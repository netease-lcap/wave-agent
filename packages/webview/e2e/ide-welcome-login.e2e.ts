import { test, expect } from "./utils/webviewTestHarness.js";
import { MessageInjector } from "./utils/messageInjector.js";

/**
 * e2e（真浏览器 + 真 chat.js bundle）— IDE 宿主的登录门禁。
 *
 * 出处：spec sso-auth「IDE 插件更多菜单与欢迎页」场景 5／边界情况「IDE 宿主不再
 * 有直连免登录旁路」＋「未认证时发送入口禁用」（2026-09-10 拍板：宿主端 API Key /
 * Base URL / headers 用户配置链路整体下线，未登录时发送入口直接置灰）。
 *
 * 语义对照单测 packages/webview/tests/webview/welcomeViewFlash.test.tsx 与
 * unauthenticatedInputDisabled.test.tsx；这里跑在未注入 `window.waveHostType`
 * （= IDE 宿主，见 src/index.tsx）的真实 bundle 上，覆盖 `showLogin` 与输入框
 * disabled/占位文案在真实 ChatApp 数据流里的取值：setInitialState.isAuthenticated
 * 与「遗留直连配置」都不再能关掉登录入口或放开输入框。
 */

function sentCommands(page: import("@playwright/test").Page) {
  return page.evaluate(() =>
    ((window.testMessages ?? []) as Array<{ command?: string }>).map((m) => ({
      command: m.command,
    })),
  );
}

async function bootIdeHost(
  page: import("@playwright/test").Page,
  initialState: Record<string, unknown>,
) {
  const injector = new MessageInjector(page);
  // setInitialState 在 ChatApp 挂载前发出会被丢（listener 在 passive effect 里），
  // 观察 webviewReady 保证 listener 已在（见 MessageInjector 注释）。
  await injector.waitForChatAppReady();
  await injector.simulateExtensionMessage("setInitialState", initialState);
  return injector;
}

test.describe("IDE 宿主欢迎页登录入口（真 bundle）", () => {
  test("未认证时显示登录引导与登录按钮，点击发出 login", async ({
    webviewPage,
  }) => {
    await bootIdeHost(webviewPage, {
      messages: [],
      isStreaming: false,
      sessions: [],
      isAuthenticated: false,
      permissionMode: "default",
    });

    await expect(webviewPage.getByTestId("welcome-wordmark")).toBeVisible();
    await expect(webviewPage.getByTestId("welcome-login-hint")).toBeVisible();
    await expect(webviewPage.getByTestId("welcome-login-btn")).toBeVisible();

    await webviewPage.getByTestId("welcome-login-btn").click();
    await expect
      .poll(async () => (await sentCommands(webviewPage)).map((m) => m.command))
      .toContain("login");
  });

  test("遗留的直连配置不再关掉登录入口（免登录旁路已下线）", async ({
    webviewPage,
  }) => {
    await bootIdeHost(webviewPage, {
      messages: [],
      isStreaming: false,
      sessions: [],
      isAuthenticated: false,
      // 修复前：这三项（来自插件 globalState 的历史残留）会隐藏登录引导，
      // 用户不登录也能聊天；修复后宿主不再读取/回带它们，登录入口必须在。
      permissionMode: "default",
    });

    await expect(webviewPage.getByTestId("welcome-login-hint")).toBeVisible();
    await expect(webviewPage.getByTestId("welcome-login-btn")).toBeVisible();
  });

  test("已认证时不显示登录入口", async ({ webviewPage }) => {
    await bootIdeHost(webviewPage, {
      messages: [],
      isStreaming: false,
      sessions: [],
      isAuthenticated: true,
      permissionMode: "default",
    });

    await expect(webviewPage.getByTestId("welcome-wordmark")).toBeVisible();
    await expect(webviewPage.getByTestId("welcome-login-btn")).toHaveCount(0);
    await expect(webviewPage.getByTestId("welcome-login-hint")).toHaveCount(0);
  });

  test("未认证时发送入口禁用，禁用原因写在输入框占位文案里", async ({
    webviewPage,
  }) => {
    await bootIdeHost(webviewPage, {
      messages: [],
      isStreaming: false,
      sessions: [],
      isAuthenticated: false,
      permissionMode: "default",
    });

    const input = webviewPage.getByTestId("message-input");
    await expect(input).toHaveAttribute("contenteditable", "false");
    await expect(input).toHaveAttribute(
      "data-placeholder",
      "请先登录后再发送消息",
    );
    // 工具栏按钮整体置灰（发送按钮本来就因输入为空而禁用，改验只受 gate 影响的几个）
    await expect(webviewPage.getByLabel("添加")).toBeDisabled();
    await expect(webviewPage.getByLabel("快捷指令")).toBeDisabled();
    await expect(webviewPage.getByLabel("权限模式")).toBeDisabled();

    // 禁用原因只写在输入框里：输入区内不放登录按钮，也不写「请去某处登录」的指路文案
    //（登录入口在欢迎页：welcome-login-btn）。
    const container = webviewPage.getByTestId("input-container");
    await expect(container.locator("button[aria-label*='登录']")).toHaveCount(
      0,
    );
    await expect(container).not.toContainText("请去");
  });

  test("登录后同一输入框恢复可编辑，占位文案回到默认提示", async ({
    webviewPage,
  }) => {
    const injector = await bootIdeHost(webviewPage, {
      messages: [],
      isStreaming: false,
      sessions: [],
      isAuthenticated: false,
      permissionMode: "default",
    });

    const input = webviewPage.getByTestId("message-input");
    await expect(input).toHaveAttribute("contenteditable", "false");

    await injector.simulateExtensionMessage("authStatusResponse", {
      isAuthenticated: true,
    });

    await expect(input).toHaveAttribute("contenteditable", "true");
    await expect(input).toHaveAttribute(
      "data-placeholder",
      "/快捷指令，@添加上下文，粘贴图片，Enter发送...",
    );
    await expect(webviewPage.getByLabel("添加")).toBeEnabled();
    await expect(webviewPage.getByLabel("快捷指令")).toBeEnabled();
    await expect(webviewPage.getByLabel("权限模式")).toBeEnabled();
  });
});
