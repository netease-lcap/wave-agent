import type { Page } from "@playwright/test";
import { test, expect } from "./utils/desktopTestHarness.js";
import { MessageInjector } from "./utils/messageInjector.js";
import { MockDataGenerator } from "./fixtures/mockData.js";

/**
 * 预览全屏里的浮动 AI 对话框（spec desktop-preview.md 场景 6 / 7 / 8 / 9）。
 *
 * 全屏状态下对话列缩成底部居中的浮卡（同一个 <MessageInput> 实例，不是第二个输入
 * 框）：元素拾取提交的评论直接追加进它、不退出全屏；发送后换成「正在工作」加载态，
 * 本轮结束恢复为空白输入框。
 *
 * 真 Chromium（e2e）：这些断言全部依赖样式与可见性（浮卡位置、输入卡被隐藏），
 * jsdom 跑不出来。截图由 `demo/desktop-preview-comment-fullscreen.demo.ts` 负责，
 * 本文件只做行为断言。
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

test.describe("Desktop preview fullscreen floating dialog", () => {
  test("a picker comment lands in the floating dialog, and sending shows the working state", async ({
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

    // ── 1. 全屏：对话列变成浮动对话框（场景 8），消息列表不显示 ─────────
    await webviewPage.getByTestId("panel-fullscreen").click();
    const chatBody = webviewPage.locator(".desktop-chat-body");
    await expect(chatBody).toHaveClass(/preview-fullscreen/);
    await expect(webviewPage.locator(".desktop-chat-main")).toBeVisible();
    const input = webviewPage.getByTestId("message-input");
    await expect(input).toBeVisible();
    // 已发出的消息不进浮卡（浮卡只放输入区）。
    await expect(
      webviewPage.getByText("帮我做一个订单管理页面的原型").first(),
    ).toBeHidden();

    // 拾取开关在全屏里仍可达（它在面板自己的工具栏里）。
    await webviewPage.getByTestId("preview-picker-toggle").click();
    await expect(webviewPage.getByTestId("preview-picker-toggle")).toHaveClass(
      /active/,
    );

    // ── 2. 全屏里提交评论：不退出全屏，评论落进浮卡并聚焦（场景 6）──────
    await submitPickerComment(webviewPage, "这里改成主要按钮样式", "button");
    await expect(chatBody).toHaveClass(/preview-fullscreen/);
    await expect(input).toContainText("这里改成主要按钮样式");
    await expect(input).toBeFocused();

    // ── 3. 第二条评论追加，不覆盖第一条 ────────────────────────────────
    await submitPickerComment(webviewPage, "订单号这一列再宽一点", "span");
    await expect(input).toContainText("这里改成主要按钮样式");
    await expect(input).toContainText("订单号这一列再宽一点");

    // ── 4. 发送后换成「正在工作」，本轮结束恢复空白输入框（场景 9）──────
    await webviewPage.getByTestId("send-btn").click();
    const sent = await injector.getMessagesSentToExtension();
    expect(sent.some((m) => m.command === "sendMessage")).toBe(true);
    // 流式态由宿主事件驱动（webview 不乐观置位）。
    await injector.startStreaming();
    const working = webviewPage.getByTestId("preview-floating-working");
    await expect(working).toBeVisible();
    await expect(working).toContainText("正在工作");
    await expect(input).toBeHidden();

    await injector.endStreaming();
    await expect(working).toHaveCount(0);
    await expect(input).toBeVisible();
    await expect(input).toHaveText("");
  });

  test("退出全屏后输入卡回到对话列，草稿与焦点都不丢（场景 7）", async ({
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
      MockDataGenerator.createAssistantMessage(
        "点击 [http://localhost:5173](http://localhost:5173) 在右侧预览。",
        "msg-a1",
      ),
    ]);
    await webviewPage.locator('a[href="http://localhost:5173"]').click();
    await expect(webviewPage.getByTestId("preview-pane")).toBeVisible();

    const draft = "这条还没发出去";
    const input = webviewPage.getByTestId("message-input");
    await input.click();
    await webviewPage.keyboard.insertText(draft);
    await expect(input).toHaveText(draft);

    await webviewPage.getByTestId("panel-fullscreen").click();
    await expect(input).toBeVisible();
    await expect(input).toHaveText(draft);

    await webviewPage.getByTestId("panel-fullscreen").click();
    await expect(webviewPage.locator(".desktop-chat-body")).not.toHaveClass(
      /preview-fullscreen/,
    );
    await expect(input).toBeVisible();
    await expect(input).toHaveText(draft);
    await expect(input).toBeFocused();
  });

  /**
   * 全屏浮卡只有 420px：底栏放不下「模型名 + 跳过权限确认 + 71% + / + / 发送」，
   * 模型名会溢出压到上下文用量指示器上（PM 3503127847500032 的桌面同款；插件端见
   * ide-composer-compact.e2e.ts）。这里守的是**桌面档尺寸**：收成图标后必须是
   * 32×32（与 + / / 同档），不是插件端的 22×22。
   */
  test("全屏浮卡的底栏收成 32×32 图标档，模型名不压到上下文用量上", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 1440, height: 900 });

    await injector.simulateExtensionMessage("desktopWorkdirState", {
      workdir: DIR_A,
      recentWorkdirs: [DIR_A],
    });
    await injector.waitForChatAppReady();
    await injector.simulateExtensionMessage("setInitialState", {
      ...initialState,
      permissionMode: "bypassPermissions",
    });
    await injector.simulateExtensionMessage("configuredModels", {
      models: [
        {
          name: "deepseek-flash",
          provider: "deepseek",
          model: "deepseek-flash",
        },
      ],
      currentModel: "deepseek-flash",
    });
    await injector.updateMessages([
      MockDataGenerator.createUserMessage("做个原型", "msg-u1"),
      MockDataGenerator.createAssistantMessage(
        "点击 [http://localhost:5173](http://localhost:5173) 在右侧预览。",
        "msg-a1",
      ),
    ]);
    await injector.simulateExtensionMessage("contextUsage", { percent: 71 });

    await webviewPage.locator('a[href="http://localhost:5173"]').click();
    await expect(webviewPage.getByTestId("preview-pane")).toBeVisible();
    await webviewPage.getByTestId("panel-fullscreen").click();
    await expect(webviewPage.locator(".desktop-chat-body")).toHaveClass(
      /preview-fullscreen/,
    );
    await webviewPage.waitForFunction(() => {
      const row = document.querySelector(
        ".desktop-chat-main .input-buttons-row",
      );
      return !!row && row.className.includes("is-compact");
    });

    const geo = await webviewPage.evaluate(() => {
      const row = document.querySelector(
        ".desktop-chat-main .input-buttons-row",
      ) as HTMLElement;
      const trigger = row.querySelector(".model-picker-trigger") as HTMLElement;
      const ring = row.querySelector(".compress-context-button") as HTMLElement;
      const name = row.querySelector(".model-picker-name") as HTMLElement;
      const brain = row.querySelector(".model-picker-icon") as HTMLElement;
      const plusBtn = row.querySelector(".toolbar-icon-button");
      const permBtn = row.querySelector(
        ".permission-mode-select",
      ) as HTMLElement;
      const readSurface = (el: Element | null) => {
        if (!el) return null;
        const cs = getComputedStyle(el);
        return {
          radius: cs.borderTopLeftRadius,
          borderColor: cs.borderTopColor,
        };
      };
      const tb = trigger.getBoundingClientRect();
      const rb = ring.getBoundingClientRect();
      return {
        triggerWidth: Math.round(tb.width),
        triggerHeight: Math.round(tb.height),
        permissionWidth: Math.round(
          row.querySelector(".permission-mode-select")!.getBoundingClientRect()
            .width,
        ),
        nameHidden: getComputedStyle(name).display === "none",
        // 图标档的大脑与「+」「/」同色（spec 场景 7）：桌面端两者都是 Figma 图标色。
        iconColor: brain ? getComputedStyle(brain).color : null,
        toolbarIconColor: plusBtn ? getComputedStyle(plusBtn).color : null,
        // 交互面同档（spec 场景 8）：圆角一致、模型/权限不带 focusBorder 框。
        plusSurface: readSurface(plusBtn),
        modelSurface: readSurface(trigger),
        permissionSurface: readSurface(permBtn),
        modelOnRing: Math.round(Math.max(0, tb.right - rb.left)),
        rowOverflow: row.scrollWidth - row.clientWidth,
      };
    });

    expect(geo.triggerWidth).toBe(32);
    expect(geo.triggerHeight).toBe(32);
    expect(geo.permissionWidth).toBe(32);
    expect(geo.nameHidden).toBe(true);
    expect(geo.iconColor).toBe(geo.toolbarIconColor);
    expect(geo.modelSurface!.radius).toBe(geo.plusSurface!.radius);
    expect(geo.permissionSurface!.radius).toBe(geo.plusSurface!.radius);
    expect(geo.modelSurface!.borderColor).toBe("rgba(0, 0, 0, 0)");
    expect(geo.permissionSurface!.borderColor).toBe("rgba(0, 0, 0, 0)");
    expect(geo.modelOnRing).toBe(0);
    expect(geo.rowOverflow).toBe(0);
  });
});
