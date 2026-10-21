import type { Page } from "@playwright/test";
import { test, expect } from "../e2e/utils/desktopTestHarness.js";
import { MessageInjector } from "../e2e/utils/messageInjector.js";
import { MockDataGenerator } from "../e2e/fixtures/mockData.js";
import { screenshotWebp } from "../e2e/utils/screenshot.js";

/**
 * Screenshot generation only — 本文件只负责把界面推到要拍的状态并截图，不承担回归。
 * 行为断言在 e2e/desktop-preview-floating-dialog.e2e.ts（浮卡 + 评论落点 + 工作态）
 * 与 e2e/desktop-draft-preserved.e2e.ts（进出全屏草稿与焦点）。改行为去改那边。
 *
 * Desktop preview fullscreen + element picker comment (real Chromium).
 *
 * 需求八（2026-09-16）：全屏里也要能看到对话。全屏状态下对话列缩成底部居中的浮动
 * 对话框（spec desktop-preview.md 场景 8），元素选择器提交的评论直接追加进这个对话框；
 * 发送后对话框换成「正在工作」加载态（场景 9），本轮结束恢复空白输入框。
 *
 * 历史上的缺陷（已由浮动对话框取代）：全屏期间对话栏整块不渲染 → <MessageInput> 连同
 * messageInputRef 一起卸载，`messageInputRef.current?.appendText(...)` 的可选链把评论
 * 静默吞掉；当时的修法是「提交后自动退出全屏」。
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
  test("a picker comment lands in the fullscreen floating dialog, and sending shows the working state", async ({
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

    // ── 1. Fullscreen: the conversation column becomes the floating dialog ──
    await webviewPage.getByTestId("panel-fullscreen").click();
    const chatBody = webviewPage.locator(".desktop-chat-body");
    await expect(chatBody).toHaveClass(/preview-fullscreen/);
    const floating = webviewPage.locator(".desktop-chat-main");
    await expect(floating).toBeVisible();
    const input = webviewPage.getByTestId("message-input");
    await expect(input).toBeVisible();

    // The picker is still reachable in fullscreen (its toggle lives in the
    // pane's own toolbar, and the shown guest fills the content area).
    await webviewPage.getByTestId("preview-picker-toggle").click();
    await expect(webviewPage.getByTestId("preview-picker-toggle")).toHaveClass(
      /active/,
    );

    // ── 2. Submit an element comment while fullscreen: no exit, it lands in
    //       the floating dialog and takes focus (场景 6 修订) ────────────
    await submitPickerComment(webviewPage, "这里改成主要按钮样式", "button");
    await expect(chatBody).toHaveClass(/preview-fullscreen/);
    await expect(input).toContainText("这里改成主要按钮样式");
    await expect(input).toBeFocused();
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-preview-comment-floating-dialog.webp",
    );

    // ── 3. A second pick appends to the first (batch, not replace) ─
    await submitPickerComment(webviewPage, "订单号这一列再宽一点", "span");
    await expect(input).toContainText("这里改成主要按钮样式");
    await expect(input).toContainText("订单号这一列再宽一点");

    // ── 4. Sending swaps the dialog for the "working" state until the turn
    //       ends, which restores an empty input (场景 9) ────────────────
    await webviewPage.getByTestId("send-btn").click();
    await injector.startStreaming();
    const working = webviewPage.getByTestId("preview-floating-working");
    await expect(working).toBeVisible();
    await expect(working).toContainText("正在工作");
    await expect(input).toBeHidden();
    await screenshotWebp(
      webviewPage,
      "../../docs/public/screenshots/desktop-preview-floating-working.webp",
    );

    await injector.endStreaming();
    await expect(working).toHaveCount(0);
    await expect(input).toBeVisible();
    await expect(input).toHaveText("");
  });
});
