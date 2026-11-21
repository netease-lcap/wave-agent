/**
 * 预览全屏里的浮动 AI 对话框（spec desktop-preview.md 场景 6 / 7 / 8 / 9）。
 *
 * 迁移自 `e2e/desktop-preview-floating-dialog.e2e.ts`。全屏状态下对话列缩成底部
 * 居中的浮卡（同一个 <MessageInput> 实例，不是第二个输入框）：元素拾取提交的评论
 * 直接追加进它、不退出全屏；发送后换成「正在工作」加载态，本轮结束恢复为空白
 * 输入框。
 *
 * 本套件跑在真 Chromium 里，所以浮卡位置、输入卡被隐藏、底栏收成图标档这些
 * **依赖样式与布局**的断言都能量（`desktopHarness` 打开了 `data-host="desktop"` +
 * host-desktop.css）。
 *
 * Chromium 里 <webview> 是惰性的未知元素，guest 侧的 IPC 由测试自己打桩：dispatch
 * 一个 wave-picker 的 submit ipc 事件，走真实的 PreviewPane → ChatApp → MessageInput
 * 链路（与 desktopPreview.test.tsx 同一套桩）。
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { page, userEvent } from "vitest/browser";
import { act } from "@testing-library/react";
import { MockDataGenerator } from "../fixtures/mockData";
import { sendCommand } from "./test-utils";
import {
  bootDesktop,
  isVisible,
  renderDesktopApp,
  resetHostTier,
  resetPanelState,
  sentCommands,
  waitForSelector,
} from "./desktopHarness";

const DIR_A = "/Users/dev/projects/wave-agent";
const PREVIEW_URL = "http://localhost:5173";
const USER_TEXT = "帮我做一个订单管理页面的原型，先跑起来看看效果";

afterEach(() => {
  resetHostTier();
  resetPanelState();
  delete window.waveHostType;
});

// 链接分流是桌面宿主的行为：`Message` 的 `handleContentClick` 在
// `window.waveHostType !== "desktop"` 时**先返回、不 preventDefault**，真 Chromium
// 会照着 `<a href>` 把测试页导航走。真机上这个全局由 Electron preload 注入，
// `desktopHarness` 只负责 `data-host`，所以这里自己补上（与 previewPane 里
// 「DesktopApp integration」那组用例同一做法）。
beforeEach(() => {
  window.waveHostType = "desktop";
});

type StubWebview = HTMLElement & {
  send: (channel: string, payload: unknown) => void;
  loadURL: (url: string) => Promise<void>;
  reload: () => void;
};

function guestWebview(): StubWebview {
  const wv = document.querySelector("webview");
  if (!wv) throw new Error("preview pane rendered no <webview>");
  return wv as unknown as StubWebview;
}

/** guest 侧 IPC：Chromium 里 `<webview>` 是惰性未知元素，事件由测试自己派。 */
function fireGuestIpc(args: unknown[]) {
  const ipc = new Event("ipc-message") as Event & {
    channel: string;
    args: unknown[];
  };
  ipc.channel = "wave-picker";
  ipc.args = args;
  act(() => {
    guestWebview().dispatchEvent(ipc);
  });
}

/** Stub the guest's IPC surface and announce dom-ready + picker-ready. */
function stubPreviewGuest() {
  const wv = guestWebview();
  act(() => {
    wv.send = () => {};
    wv.loadURL = async () => {};
    wv.reload = () => {};
    wv.dispatchEvent(new Event("dom-ready"));
  });
  fireGuestIpc([{ type: "ready" }]);
}

/** The guest's "添加到输入框" — the picker posts this ipc to the host pane. */
function submitPickerComment(comment: string, summary: string) {
  fireGuestIpc([
    {
      type: "submit",
      url: PREVIEW_URL,
      selector: `#mock-prototype ${summary}`,
      summary,
      text: "",
      comment,
    },
  ]);
}

type MockMessage = ReturnType<typeof MockDataGenerator.createAssistantMessage>;

/** 起一个桌面分屏，按需推消息（`bootDesktop` 保证 workdir → 初值 → 消息的次序）。 */
function boot(options: { messages?: MockMessage[]; permissionMode?: string }) {
  const result = renderDesktopApp();
  bootDesktop({
    workdir: DIR_A,
    // `bootDesktop` 收的是「任意对象」，而 `Message` 是带具体字段的 interface（没有
    // 索引签名），所以这里显式转一手。
    messages: (options.messages ?? []) as unknown as Record<string, unknown>[],
    extra: options.permissionMode
      ? { permissionMode: options.permissionMode }
      : {},
  });
  return result;
}

/** 点消息里的 localhost 链接把预览面板打开。 */
function openPreviewPane() {
  const link = document.querySelector(`a[href="${PREVIEW_URL}"]`);
  if (!link) throw new Error("message rendered no localhost link");
  act(() => {
    (link as HTMLElement).click();
  });
}
const previewLinkMessage = () =>
  MockDataGenerator.createAssistantMessage(
    `已用 Vite 创建原型并启动开发服务器，点击 [${PREVIEW_URL}](${PREVIEW_URL}) 在右侧预览。`,
    "msg-a1",
  );

const chatBody = () =>
  document.querySelector<HTMLElement>(".desktop-chat-body")!;

const inputText = () =>
  document.querySelector('[data-testid="message-input"]')?.textContent ?? "";

/**
 * 直接持有这段文字的元素——对齐 Playwright 的 `getByText`（lax 匹配只认元素**自己**
 * 的文本节点，不会把「祖先的 textContent 里含这段」（含被隐藏子树）也算命中）。
 */
function textOwners(text: string): HTMLElement[] {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const owners: HTMLElement[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!(node.nodeValue ?? "").includes(text)) continue;
    const owner = node.parentElement;
    if (owner && !owners.includes(owner)) owners.push(owner);
  }
  return owners;
}

/** 元素真的画在屏上：盒非空，且自身不是 display:none / visibility:hidden。 */
function isRendered(el: HTMLElement): boolean {
  const style = getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") return false;
  return Array.from(el.getClientRects()).some(
    (r) => r.width > 0 && r.height > 0,
  );
}

const permissionMenuItems = () =>
  Array.from(
    document.querySelectorAll<HTMLElement>(".permission-mode-item"),
  ).map((li) => {
    const icon = li.querySelector(".permission-mode-icon")!;
    const iconRect = icon.getBoundingClientRect();
    // 文案是 li 的文本节点（不是子元素），只能用 Range 取墨盒。
    const textNode = Array.from(li.childNodes).find(
      (n) => n.nodeType === Node.TEXT_NODE,
    )!;
    const range = document.createRange();
    range.selectNodeContents(textNode);
    const textRect = range.getBoundingClientRect();
    return {
      label: (textNode.textContent ?? "").trim(),
      display: getComputedStyle(li).display,
      /** 图标圆心 Y − 文案墨盒中心 Y：负值 = 图标偏上。 */
      iconCenterMinusTextCenter: +(
        (iconRect.top + iconRect.bottom) / 2 -
        (textRect.top + textRect.bottom) / 2
      ).toFixed(2),
      /** 图标右缘到文案左缘的水平距离（= flex gap 的实测值）。 */
      iconRightToTextLeft: +(textRect.left - iconRect.right).toFixed(2),
    };
  });

describe("Desktop preview fullscreen floating dialog", () => {
  it("a picker comment lands in the floating dialog, and sending shows the working state", async () => {
    await page.viewport(1100, 680);
    const { vscode } = boot({
      messages: [
        MockDataGenerator.createUserMessage(USER_TEXT, "msg-u1"),
        previewLinkMessage(),
      ],
    });

    // Open the preview pane, then stub the guest side.
    openPreviewPane();
    await expect
      .poll(() => isVisible('[data-testid="preview-pane"]'))
      .toBe(true);
    stubPreviewGuest();

    // ── 1. 全屏：对话列变成浮动对话框（场景 8），消息列表不显示 ─────────
    await userEvent.click(
      await waitForSelector('[data-testid="panel-fullscreen"]'),
    );
    await expect
      .poll(() => chatBody().className)
      .toContain("preview-fullscreen");
    expect(isVisible(".desktop-chat-main")).toBe(true);
    expect(isVisible('[data-testid="message-input"]')).toBe(true);
    // 已发出的消息不进浮卡（浮卡只放输入区）：这段文字确实在 DOM 里，但没有一块
    // 是画出来的。
    const owners = textOwners("帮我做一个订单管理页面的原型");
    expect(owners.length).toBeGreaterThan(0);
    expect(owners.filter(isRendered)).toHaveLength(0);

    // 拾取开关在全屏里仍可达（它在面板自己的工具栏里）。
    await userEvent.click(
      await waitForSelector('[data-testid="preview-picker-toggle"]'),
    );
    await expect
      .poll(
        () =>
          document.querySelector('[data-testid="preview-picker-toggle"]')
            ?.className ?? "",
      )
      .toContain("active");

    // ── 2. 全屏里提交评论：不退出全屏，评论落进浮卡并聚焦（场景 6）──────
    submitPickerComment("这里改成主要按钮样式", "button");
    await expect
      .poll(() => chatBody().className)
      .toContain("preview-fullscreen");
    await expect.poll(inputText).toContain("这里改成主要按钮样式");
    expect(document.activeElement).toBe(
      document.querySelector('[data-testid="message-input"]'),
    );

    // ── 3. 第二条评论追加，不覆盖第一条 ────────────────────────────────
    submitPickerComment("订单号这一列再宽一点", "span");
    await expect.poll(inputText).toContain("这里改成主要按钮样式");
    await expect.poll(inputText).toContain("订单号这一列再宽一点");

    // ── 4. 发送后换成「正在工作」，本轮结束恢复空白输入框（场景 9）──────
    await userEvent.click(await waitForSelector('[data-testid="send-btn"]'));
    await expect
      .poll(
        () =>
          sentCommands(vscode).filter((m) => m.command === "sendMessage")
            .length,
      )
      .toBeGreaterThan(0);
    // 流式态由宿主事件驱动（webview 不乐观置位）。
    sendCommand("startStreaming");
    await expect
      .poll(() => isVisible('[data-testid="preview-floating-working"]'))
      .toBe(true);
    expect(
      document.querySelector('[data-testid="preview-floating-working"]')
        ?.textContent ?? "",
    ).toContain("正在工作");
    await expect
      .poll(() => isVisible('[data-testid="message-input"]'))
      .toBe(false);

    sendCommand("endStreaming");
    await expect
      .poll(
        () =>
          document.querySelectorAll('[data-testid="preview-floating-working"]')
            .length,
      )
      .toBe(0);
    await expect
      .poll(() => isVisible('[data-testid="message-input"]'))
      .toBe(true);
    expect(inputText().trim()).toBe("");
  });

  it("退出全屏后输入卡回到对话列，草稿与焦点都不丢（场景 7）", async () => {
    await page.viewport(1100, 680);
    boot({ messages: [previewLinkMessage()] });

    openPreviewPane();
    await expect
      .poll(() => isVisible('[data-testid="preview-pane"]'))
      .toBe(true);

    const draft = "这条还没发出去";
    const input = await waitForSelector('[data-testid="message-input"]');
    await userEvent.click(input);
    await userEvent.fill(input as HTMLElement, draft);
    await expect.poll(inputText).toBe(draft);

    await userEvent.click(
      await waitForSelector('[data-testid="panel-fullscreen"]'),
    );
    expect(isVisible('[data-testid="message-input"]')).toBe(true);
    await expect.poll(inputText).toBe(draft);

    await userEvent.click(
      await waitForSelector('[data-testid="panel-fullscreen"]'),
    );
    await expect
      .poll(() => chatBody().className)
      .not.toContain("preview-fullscreen");
    expect(isVisible('[data-testid="message-input"]')).toBe(true);
    await expect.poll(inputText).toBe(draft);
    expect(document.activeElement).toBe(
      document.querySelector('[data-testid="message-input"]'),
    );
  });

  /**
   * 全屏浮卡只有 420px：底栏放不下「模型名 + 跳过权限确认 + 71% + / + / 发送」，
   * 模型名会溢出压到上下文用量指示器上（PM 3503127847500032 的桌面同款）。这里守的
   * 是**桌面档尺寸**：收成图标后必须是 32×32（与 + / / 同档），不是插件端的 22×22。
   */
  it("全屏浮卡的底栏收成 32×32 图标档，模型名不压到上下文用量上", async () => {
    await page.viewport(1440, 900);
    boot({ permissionMode: "bypassPermissions" });
    sendCommand("configuredModels", {
      models: [
        {
          name: "deepseek-flash",
          provider: "deepseek",
          model: "deepseek-flash",
        },
      ],
      currentModel: "deepseek-flash",
    });
    sendCommand("updateMessages", {
      messages: [
        MockDataGenerator.createUserMessage("做个原型", "msg-u1"),
        previewLinkMessage(),
      ],
    });
    sendCommand("contextUsage", { percent: 71 });

    openPreviewPane();
    await expect
      .poll(() => isVisible('[data-testid="preview-pane"]'))
      .toBe(true);
    await userEvent.click(
      await waitForSelector('[data-testid="panel-fullscreen"]'),
    );
    await expect
      .poll(() => chatBody().className)
      .toContain("preview-fullscreen");
    await expect
      .poll(
        () => {
          const row = document.querySelector(
            ".desktop-chat-main .input-buttons-row",
          );
          return !!row && row.className.includes("is-compact");
        },
        { timeout: 4000 },
      )
      .toBe(true);

    const row = document.querySelector<HTMLElement>(
      ".desktop-chat-main .input-buttons-row",
    )!;
    const trigger = row.querySelector<HTMLElement>(".model-picker-trigger")!;
    const ring = row.querySelector<HTMLElement>(".compress-context-button")!;
    const name = row.querySelector<HTMLElement>(".model-picker-name")!;
    const brain = row.querySelector<HTMLElement>(".model-picker-icon");
    const plusBtn = row.querySelector<HTMLElement>(".toolbar-icon-button");
    const permBtn = row.querySelector<HTMLElement>(".permission-mode-select");
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
    const geo = {
      triggerWidth: Math.round(tb.width),
      triggerHeight: Math.round(tb.height),
      permissionWidth: Math.round(permBtn!.getBoundingClientRect().width),
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

  /**
   * 空会话（欢迎页还在）时全屏预览：浮卡里只剩输入卡。
   *
   * <WelcomeView> 的根节点自带内联 display:flex，内联样式压过
   * `.desktop-chat-main > :not(.input-area-container)` 的 display:none —— 隐藏规则
   * 不写 !important 就「命中但不生效」，浮卡顶部多出一行 Codewave 字标（24px 字标
   * + 40px gap，浮卡从 420×154 撑到 420×218）。
   */
  it("空会话下全屏预览，浮卡里不出现欢迎页字标", async () => {
    await page.viewport(1440, 1000);
    boot({});
    await expect
      .poll(() => isVisible('[data-testid="welcome-wordmark"]'))
      .toBe(true);

    // 空会话没有消息里的预览链接，从头部面板开关的空态入口打开预览。
    await userEvent.click(
      await waitForSelector('[data-testid="panel-toggle-btn"]'),
    );
    await userEvent.click(
      await waitForSelector('[data-testid="panel-empty-item-preview"]'),
    );
    await expect
      .poll(() => isVisible('[data-testid="preview-pane-empty"]'))
      .toBe(true);

    await userEvent.click(
      await waitForSelector('[data-testid="panel-fullscreen"]'),
    );
    await expect
      .poll(() => chatBody().className)
      .toContain("preview-fullscreen");

    await expect
      .poll(() => isVisible('[data-testid="welcome-wordmark"]'))
      .toBe(false);

    const h = (selector: string) =>
      Math.round(
        document.querySelector(selector)!.getBoundingClientRect().height,
      );
    // 浮卡高度等于输入卡高度：没有多出来的品牌行（字标 24 + gap 40）。
    expect(h(".desktop-chat-main")).toBe(
      h(".desktop-chat-main .input-area-container"),
    );
  });

  /**
   * 权限下拉菜单项：图标与文案同一水平线、中间留出间距。
   *
   * 桌面端这一档一直是好的（host-desktop.css 自己声明了 flex/居中/8px），这条用例是
   * 回归守卫 —— 2026-10-26 修的缺陷只落在插件端与远控页（它们走 base 规则），三端共用
   * 同一个断言，改 base 规则时不会把桌面端带坏。
   */
  it("the permission menu's icon and label sit on one line", async () => {
    await page.viewport(1440, 900);
    boot({ permissionMode: "bypassPermissions" });
    sendCommand("configuredModels", {
      models: [
        {
          name: "deepseek-flash",
          provider: "deepseek",
          model: "deepseek-flash",
        },
      ],
      currentModel: "deepseek-flash",
    });

    await userEvent.click(await waitForSelector(".permission-mode-select"));
    await expect.poll(() => isVisible(".permission-mode-menu")).toBe(true);

    const items = permissionMenuItems();
    expect(items).toHaveLength(4);
    for (const item of items) {
      // `align-items: center` 居中的是行盒，而 Range 取到的是文字**墨盒**，两者按
      // 字体度量天然差 1～1.5px，所以取 ±2px；缺陷态是 −4～−5px，落在容差外。
      expect(
        Math.abs(item.iconCenterMinusTextCenter),
        `${item.label} 图标与文案应在同一水平线（实测差 ${item.iconCenterMinusTextCenter}px）`,
      ).toBeLessThanOrEqual(2);
      expect(
        item.iconRightToTextLeft,
        `${item.label} 图标与文案之间应留出间距（实测 ${item.iconRightToTextLeft}px）`,
      ).toBeGreaterThanOrEqual(6);
      // 上面两条是用户看到的现象；这条是成因（不声明 display 时 `<li>` 走基线排）。
      expect(item.display, `${item.label} 应是 flex 行`).toBe("flex");
    }
  });
});
