import type { Page } from "@playwright/test";
import { test, expect } from "../e2e/utils/desktopTestHarness.js";
import { MessageInjector } from "../e2e/utils/messageInjector.js";
import { MockDataGenerator } from "../e2e/fixtures/mockData.js";
import { screenshotWebp } from "../e2e/utils/screenshot.js";

/**
 * Desktop preview fullscreen + element picker comment (real Chromium).
 *
 * 缺陷现象：预览面板全屏状态下用元素选择器提交评论，界面毫无反应 —— 评论静默丢失，
 * 也不退出全屏。根因见 ChatApp handleAddComment 的注释：全屏期间对话栏整块不渲染
 * （.desktop-chat-main 连 <MessageInput> 一起卸载），messageInputRef 恒 null，
 * `messageInputRef.current?.appendText(...)` 的可选链把评论吞了。
 *
 * 期望：提交后自动退出全屏，评论落进聊天输入框（追加而非替换）并聚焦。
 *
 * Chromium 里 <webview> 是惰性的未知元素，guest 侧的 IPC 由测试自己打桩：dispatch
 * 一个 wave-picker 的 submit ipc 事件，走真实的 PreviewPane → ChatApp → MessageInput
 * 链路（与 desktop-preview.e2e.ts 同一套桩）。
 */
const DIR_A = "/Users/dev/projects/wave-agent";

const initialState = {
  messages: [],
  isStreaming: false,
  sessions: [],
  isAuthenticated: true,
  permissionMode: "default",
};

/** Stub the guest's IPC surface and announce dom-ready + picker-ready. */
async function stubPreviewGuest(page: Page) {
  await page.evaluate(() => {
    const wv = document.querySelector("webview") as unknown as Record<
      string,
      unknown
    > &
      HTMLElement;
    wv.send = () => {};
    wv.loadURL = async () => {};
    wv.reload = () => {};
    wv.dispatchEvent(new Event("dom-ready"));
    const ipc = new Event("ipc-message") as Event & {
      channel: string;
      args: unknown[];
    };
    ipc.channel = "wave-picker";
    ipc.args = [{ type: "ready" }];
    wv.dispatchEvent(ipc);
  });
}

/** The guest's "添加到输入框" — the picker posts this ipc to the host pane. */
async function submitPickerComment(
  page: Page,
  comment: string,
  summary: string,
) {
  await page.evaluate(
    ({ comment, summary }) => {
      const wv = document.querySelector("webview") as HTMLElement;
      const ipc = new Event("ipc-message") as Event & {
        channel: string;
        args: unknown[];
      };
      ipc.channel = "wave-picker";
      ipc.args = [
        {
          type: "submit",
          url: "http://localhost:5173",
          selector: `#mock-prototype ${summary}`,
          summary,
          text: "",
          comment,
        },
      ];
      wv.dispatchEvent(ipc);
    },
    { comment, summary },
  );
}

test.describe("Desktop preview fullscreen element comments", () => {
  test("a picker comment submitted in fullscreen exits fullscreen and lands in the chat input", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 1100, height: 680 });

    await injector.simulateExtensionMessage("desktopWorkdirState", {
      workdir: DIR_A,
      recentWorkdirs: [DIR_A],
    });
    await injector.waitForChatAppReady();
    await injector.simulateExtensionMessage("setInitialState", initialState);
    await injector.updateMessages([
      MockDataGenerator.createUserMessage(
        "帮我做一个订单管理页面的原型，先跑起来看看效果",
        "msg-u1",
      ),
      MockDataGenerator.createAssistantMessage(
        "已用 Vite 创建原型并启动开发服务器，点击 [http://localhost:5173](http://localhost:5173) 在右侧预览。",
        "msg-a1",
      ),
    ]);

    // Open the preview pane, then stub the guest side.
    await webviewPage.locator('a[href="http://localhost:5173"]').click();
    await expect(webviewPage.getByTestId("preview-pane")).toBeVisible();
    await stubPreviewGuest(webviewPage);

    // ── 1. Fullscreen: the conversation column unmounts ────────────
    await webviewPage.getByTestId("panel-fullscreen").click();
    const chatBody = webviewPage.locator(".desktop-chat-body");
    await expect(chatBody).toHaveClass(/preview-fullscreen/);
    await expect(webviewPage.locator(".desktop-chat-main")).toHaveCount(0);

    // The picker is still reachable in fullscreen (its toggle lives in the
    // pane's own toolbar, and the shown guest fills the content area).
    await webviewPage.getByTestId("preview-picker-toggle").click();
    await expect(webviewPage.getByTestId("preview-picker-toggle")).toHaveClass(
      /active/,
    );

    // ── 2. Submit an element comment while fullscreen ──────────────
    await submitPickerComment(webviewPage, "这里改成主要按钮样式", "button");

    // Fullscreen exits on its own (no Esc) and the conversation comes back.
    await expect(chatBody).not.toHaveClass(/preview-fullscreen/);
    await expect(webviewPage.locator(".desktop-chat-main")).toHaveCount(1);
    const input = webviewPage.getByTestId("message-input");
    await expect(input).toContainText("这里改成主要按钮样式");
    await expect(input).toBeFocused();

    // ── 3. A second pick appends to the first (batch, not replace) ─
    await submitPickerComment(webviewPage, "订单号这一列再宽一点", "span");
    await expect(input).toContainText("这里改成主要按钮样式");
    await expect(input).toContainText("订单号这一列再宽一点");
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-preview-comment-after-fullscreen.webp",
    );
  });
});
