import { test, expect } from "./utils/desktopTestHarness.js";
import { MessageInjector } from "./utils/messageInjector.js";

const WORKDIR = "/Users/dev/projects/wave-agent";

/**
 * e2e（真浏览器 + 真 chat.js bundle，`window.waveHostType = 'desktop'`）—
 * 桌面端未认证时的发送入口形态。
 *
 * 出处：spec `docs/specs/enterprise/sso-auth.md`「未认证时发送入口禁用」
 *（2026-09-10 拍板：两端同一形态——未登录时复用 MessageInput 既有的 disabled 语义，
 * 禁用原因只写在输入框占位文案里）。单测对照
 * `packages/webview/tests/webview/unauthenticatedInputDisabled.test.tsx`（未登录）与
 * `desktopApp.test.tsx`「should disable the input area when no workdir is selected」
 *（桌面未选目录）；这里把两条原因放进同一个真实 bundle 里，验证它们**各自独立生效**
 * 且登录原因优先于目录原因。
 */

/** DesktopApp 只在 desktopWorkdirState 之后挂载布局，故按真实顺序推消息。 */
async function bootDesktop(
  page: import("@playwright/test").Page,
  workdir: string | undefined,
  isAuthenticated: boolean,
) {
  const injector = new MessageInjector(page);
  await injector.simulateExtensionMessage("desktopWorkdirState", {
    ...(workdir ? { workdir } : {}),
    recentWorkdirs: workdir ? [workdir] : [],
  });
  await injector.waitForChatAppReady();
  await injector.simulateExtensionMessage("setInitialState", {
    messages: [],
    isStreaming: false,
    sessions: [],
    isAuthenticated,
    configurationData: { model: "claude-sonnet-4-20250514" },
    permissionMode: "default",
    ...(workdir ? { workdir } : {}),
  });
  return injector;
}

test.describe("桌面端未认证时的发送入口", () => {
  test("未登录（未选目录）时禁用，占位文案是登录原因而非目录提示", async ({
    webviewPage,
  }) => {
    await bootDesktop(webviewPage, undefined, false);

    const input = webviewPage.getByTestId("message-input");
    await expect(input).toHaveAttribute("contenteditable", "false");
    // 未登录是更根本的原因：即使同时没有工作目录，显示的是登录原因。
    await expect(input).toHaveAttribute(
      "data-placeholder",
      "请先登录后再发送消息",
    );
    await expect(webviewPage.getByLabel("添加")).toBeDisabled();
    await expect(webviewPage.getByLabel("快捷指令")).toBeDisabled();
  });

  test("登录后仍未选目录：仍禁用，但占位文案换成目录原因（两条原因独立）", async ({
    webviewPage,
  }) => {
    const injector = await bootDesktop(webviewPage, undefined, false);
    await expect(webviewPage.getByTestId("message-input")).toHaveAttribute(
      "data-placeholder",
      "请先登录后再发送消息",
    );

    await injector.simulateExtensionMessage("authStatusResponse", {
      isAuthenticated: true,
    });

    const input = webviewPage.getByTestId("message-input");
    await expect(input).toHaveAttribute("contenteditable", "false");
    // 不再是登录原因 —— 剩下的唯一原因是没选工作目录，占位文案随之换成目录原因。
    await expect(input).toHaveAttribute("data-placeholder", "请先选择项目目录");
  });

  test("登录且选定目录后恢复可编辑、占位回到默认提示", async ({
    webviewPage,
  }) => {
    const injector = await bootDesktop(webviewPage, undefined, false);
    await expect(webviewPage.getByTestId("message-input")).toHaveAttribute(
      "contenteditable",
      "false",
    );

    await injector.simulateExtensionMessage("authStatusResponse", {
      isAuthenticated: true,
    });
    await injector.simulateExtensionMessage("desktopWorkdirState", {
      workdir: WORKDIR,
      recentWorkdirs: [WORKDIR],
    });
    await injector.simulateExtensionMessage("setInitialState", {
      messages: [],
      isStreaming: false,
      sessions: [],
      isAuthenticated: true,
      configurationData: { model: "claude-sonnet-4-20250514" },
      permissionMode: "default",
      workdir: WORKDIR,
    });

    const input = webviewPage.getByTestId("message-input");
    await expect(input).toHaveAttribute("contenteditable", "true");
    await expect(input).toHaveAttribute(
      "data-placeholder",
      "/快捷指令，@添加上下文，粘贴图片，Enter发送...",
    );
    await expect(webviewPage.getByLabel("添加")).toBeEnabled();
    await expect(webviewPage.getByLabel("快捷指令")).toBeEnabled();
  });
});
