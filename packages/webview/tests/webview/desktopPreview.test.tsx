/**
 * 桌面端预览面板 + 元素拾取（迁移自 `e2e/desktop-preview.e2e.ts`）。
 *
 * Chromium 里没有真的 Electron `<webview>`，所以 guest 侧是打的桩：把元素的 IPC
 * 面（send/loadURL/reload）换掉，派发 dom-ready + picker-ready 让拾取开关能亮，
 * 再在 `.preview-pane-body` 里叠一个手写的 mock 原型页。submit 那条 ipc 事件走的
 * 仍是真实的 PreviewPane → MessageInput 链路，所以「评论落进输入框」是真跑出来的。
 *
 * 本套件在真 Chromium（vitest browser mode）里跑，元素可见性、按钮的实际盒尺寸
 * 都能量。
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { page, userEvent } from "vitest/browser";
import { act } from "@testing-library/react";
import { MockDataGenerator } from "../fixtures/mockData";
import {
  bootDesktop,
  isVisible,
  renderDesktopApp,
  resetHostTier,
  resetPanelState,
  waitForSelector,
} from "./desktopHarness";

const DIR_A = "/Users/dev/projects/wave-agent";

afterEach(() => {
  resetHostTier();
  resetPanelState();
  delete window.waveHostType;
});

// 链接分流是桌面宿主的行为：`Message` 的 `handleContentClick` 在
// `window.waveHostType !== "desktop"` 时**先返回、不 preventDefault**，真 Chromium
// 会照着 `<a href>` 把测试页导航走。真机上这个全局由 Electron preload 注入，
// `desktopHarness` 只负责 `data-host`，所以这里自己补上。
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

/** Stub the guest's IPC surface (Chromium can't host a real Electron <webview>). */
function stubGuest(pickerReady: boolean) {
  const wv = guestWebview();
  act(() => {
    wv.send = () => {};
    wv.loadURL = async () => {};
    wv.reload = () => {};
    wv.dispatchEvent(new Event("dom-ready"));
  });
  if (!pickerReady) return;
  const ipc = new Event("ipc-message") as Event & {
    channel: string;
    args: unknown[];
  };
  ipc.channel = "wave-picker";
  ipc.args = [{ type: "ready" }];
  act(() => {
    wv.dispatchEvent(ipc);
  });
}

/** Mock order-management prototype overlaid on the (inert) <webview>. */
const MOCK_PROTOTYPE_HTML = `
<div id="mock-prototype" style="position:absolute;inset:0;background:#f7f8fa;color:#1f2329;font:13px/-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;overflow:hidden;">
  <div style="background:#ffffff;border-bottom:1px solid #e5e6eb;padding:12px 20px;display:flex;align-items:center;gap:10px;">
    <div style="width:22px;height:22px;border-radius:6px;background:#165dff;"></div>
    <span style="font-size:14px;font-weight:600;">订单管理后台</span>
    <span style="margin-left:auto;color:#86909c;font-size:12px;">sarah.chen</span>
  </div>
  <div style="padding:16px 20px;">
    <div style="display:flex;gap:8px;margin-bottom:14px;">
      <span style="background:#165dff;color:#fff;border-radius:14px;padding:4px 14px;font-size:12px;">全部</span>
      <span style="background:#ffffff;border:1px solid #e5e6eb;border-radius:14px;padding:4px 14px;font-size:12px;color:#4e5969;">待支付</span>
      <span id="mock-chip-shipping" style="background:#ffffff;border:1px solid #e5e6eb;border-radius:14px;padding:4px 14px;font-size:12px;color:#4e5969;">配送中</span>
      <span style="background:#ffffff;border:1px solid #e5e6eb;border-radius:14px;padding:4px 14px;font-size:12px;color:#4e5969;">已完成</span>
    </div>
    <div style="background:#ffffff;border:1px solid #e5e6eb;border-radius:8px;">
      <div style="display:grid;grid-template-columns:78px 1fr 74px 66px;gap:8px;padding:10px 16px;border-bottom:1px solid #f2f3f5;color:#86909c;font-size:12px;white-space:nowrap;">
        <span>订单号</span><span>商品</span><span>金额</span><span>状态</span>
      </div>
      <div style="display:grid;grid-template-columns:78px 1fr 74px 66px;gap:8px;padding:12px 16px;border-bottom:1px solid #f2f3f5;align-items:center;white-space:nowrap;">
        <span style="font-family:monospace;">#10241</span><span>机械键盘 × 1</span><span>¥399.00</span>
        <span style="color:#00b42a;">已完成</span>
      </div>
      <div style="display:grid;grid-template-columns:78px 1fr 74px 66px;gap:8px;padding:12px 16px;border-bottom:1px solid #f2f3f5;align-items:center;white-space:nowrap;">
        <span style="font-family:monospace;">#10242</span><span>无线鼠标 × 2</span><span>¥178.00</span>
        <span style="color:#ff7d00;">配送中</span>
      </div>
      <div style="display:grid;grid-template-columns:78px 1fr 74px 66px;gap:8px;padding:12px 16px;align-items:center;white-space:nowrap;">
        <span style="font-family:monospace;">#10243</span><span>显示器 × 1</span><span>¥1299.00</span>
        <button id="mock-pay-btn" style="background:#165dff;color:#ffffff;border:none;border-radius:4px;padding:4px 10px;font-size:12px;cursor:pointer;justify-self:start;">去支付</button>
      </div>
    </div>
  </div>
</div>`;

/**
 * Mock of the guest comment card, visually faithful to pickerPreload.showCard:
 * 280px wide, themed via the same --vscode-* vars the real palette samples.
 */
const mockCardHtml = (comment: string) => `
<div id="mock-picker-card" style="position:absolute;width:280px;background:var(--vscode-panel-background,var(--vscode-editor-background));color:var(--vscode-foreground);border:1px solid var(--vscode-panel-border,rgba(128,128,128,0.35));border-radius:6px;padding:6px;font-size:12px;line-height:1.4;box-shadow:0 4px 16px rgba(0,0,0,0.4);z-index:20;">
  <div style="display:flex;flex-direction:column;gap:2px;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-focusBorder);border-radius:6px;padding:6px;">
    <div style="width:100%;min-height:40px;">${comment}</div>
    <div style="display:flex;align-items:center;gap:6px;">
      <div style="flex:1;color:var(--vscode-button-background);font-family:monospace;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="#mock-prototype button">button</div>
      <div style="background:transparent;color:var(--vscode-button-background);border:1px solid var(--vscode-panel-border,rgba(128,128,128,0.35));border-radius:3px;font-size:11px;padding:2px 10px;">添加</div>
    </div>
  </div>
</div>`;

type MockMessage = ReturnType<typeof MockDataGenerator.createAssistantMessage>;

/** 起一个桌面分屏并按顺序推初值 + 消息（次序见 `bootDesktop` 的说明）。 */
function boot(messages: MockMessage[]) {
  const result = renderDesktopApp();
  // `bootDesktop` 收的是「任意对象」，而 `Message` 是带具体字段的 interface（没有
  // 索引签名），所以这里显式转一手。
  bootDesktop({
    workdir: DIR_A,
    messages: messages as unknown as Record<string, unknown>[],
  });
  return result;
}

/** 点消息里的链接把预览面板打开。 */
function clickLink(href: string) {
  const link = document.querySelector(`a[href="${href}"]`);
  if (!link) throw new Error(`message rendered no link to ${href}`);
  act(() => {
    (link as HTMLElement).click();
  });
}

const previewLinkMessage = (url: string, extra = "") =>
  MockDataGenerator.createAssistantMessage(
    `已用 Vite 创建原型并启动开发服务器，点击 [${url}](${url}) 在右侧预览。${extra}`,
    "msg-a1",
  );

describe("Desktop Preview Pane", () => {
  it("capture preview pane + element picker", async () => {
    await page.viewport(1100, 680);
    boot([
      MockDataGenerator.createUserMessage(
        "帮我做一个订单管理页面的原型，先跑起来看看效果",
        "msg-u1",
      ),
      previewLinkMessage(
        "http://localhost:5173",
        "页面包含订单列表、状态筛选和待支付操作。",
      ),
    ]);

    // ── 1. Open the preview pane via the localhost link ──────────
    await expect
      .poll(() => isVisible('a[href="http://localhost:5173"]'))
      .toBe(true);
    clickLink("http://localhost:5173");
    await expect
      .poll(() => isVisible('[data-testid="preview-pane"]'))
      .toBe(true);

    // Stub the guest IPC surface and announce picker readiness.
    stubGuest(true);

    // Overlay the mock prototype page.
    act(() => {
      document
        .querySelector(".preview-pane-body")
        ?.insertAdjacentHTML("beforeend", MOCK_PROTOTYPE_HTML);
    });
    await expect.poll(() => isVisible("#mock-prototype")).toBe(true);

    // ── 2. Picker active: toggle on + hover highlight outline ─────
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
    const chip = document.querySelector<HTMLElement>("#mock-chip-shipping");
    expect(chip).not.toBeNull();
    chip!.style.outline = "2px solid var(--vscode-button-background)";
    chip!.style.outlineOffset = "-2px";

    // ── 3. Comment card pinned to the picked element ──────────────
    const body = document.querySelector<HTMLElement>(".preview-pane-body")!;
    const btn = document.querySelector<HTMLElement>("#mock-pay-btn");
    expect(btn).not.toBeNull();
    const bodyRect = body.getBoundingClientRect();
    const btnRect = btn!.getBoundingClientRect();
    const wrap = document.createElement("div");
    wrap.innerHTML = mockCardHtml("这里改成主要按钮样式，并加上加载中状态");
    const card = wrap.firstElementChild as HTMLElement;
    const left = Math.min(
      btnRect.left - bodyRect.left,
      bodyRect.width - 280 - 14,
    );
    card.style.left = `${Math.max(8, left)}px`;
    card.style.top = `${btnRect.bottom - bodyRect.top + 8}px`;
    act(() => {
      body.appendChild(card);
    });
    await expect.poll(() => isVisible("#mock-picker-card")).toBe(true);

    // ── 4. Submit dismisses the card; the comment lands in the chat ─
    // input (nothing sent to the agent yet) so several can be batched.
    act(() => {
      document.querySelector("#mock-picker-card")?.remove();
    });
    const ipc = new Event("ipc-message") as Event & {
      channel: string;
      args: unknown[];
    };
    ipc.channel = "wave-picker";
    ipc.args = [
      {
        type: "submit",
        url: "http://localhost:5173",
        selector: "#mock-prototype button",
        summary: "button#mock-pay-btn",
        text: "去支付",
        comment: "这里改成主要按钮样式，并加上加载中状态",
      },
    ];
    act(() => {
      guestWebview().dispatchEvent(ipc);
    });
    // The real MessageInput now carries the formatted comment.
    await expect
      .poll(
        () =>
          document.querySelector('[data-testid="message-input"]')
            ?.textContent ?? "",
      )
      .toContain("这里改成主要按钮样式");
  });

  it("load-failure retry button stays a single-line button", async () => {
    await page.viewport(1100, 680);
    boot([
      MockDataGenerator.createUserMessage("帮我预览一下页面", "msg-u1"),
      previewLinkMessage("http://localhost:5173", "开发服务器已启动。"),
    ]);

    // Open the preview pane, then stub the guest IPC surface (the harness
    // cannot host a real Electron <webview>).
    clickLink("http://localhost:5173");
    await expect
      .poll(() => isVisible('[data-testid="preview-pane"]'))
      .toBe(true);
    stubGuest(false);

    // Simulate the dev server going away: the guest fires did-fail-load and
    // PreviewPane shows the load-error state with a "重试" button.
    const fail = new Event("did-fail-load") as Event & {
      errorCode?: number;
      errorDescription?: string;
      isMainFrame?: boolean;
    };
    fail.errorCode = -324; // ERR_EMPTY_RESPONSE
    fail.errorDescription = "ERR_EMPTY_RESPONSE";
    fail.isMainFrame = true;
    act(() => {
      guestWebview().dispatchEvent(fail);
    });

    await expect
      .poll(() => isVisible('[data-testid="preview-error"]'))
      .toBe(true);
    expect(
      document.querySelector('[data-testid="preview-error"]')?.textContent ??
        "",
    ).toContain("页面加载失败：ERR_EMPTY_RESPONSE");

    // Regression: the retry text button reuses the toolbar icon-button class
    // (24×24, no wrap). The error-state override must widen it to fit its
    // label — otherwise "重试" stacks vertically into a narrow pill.
    const retry = await waitForSelector('[data-testid="preview-retry"]');
    const box = retry.getBoundingClientRect();
    expect(box.width).toBeGreaterThan(box.height);
    expect((retry.textContent ?? "").trim()).toBe("重试");
  });

  // 围栏代码块中的 localhost 链接同样走预览面板分流（specs/ui/markdown-links.md
  // 「围栏代码块中的 URL 可点击」）：真 Chromium 下代码块内的 <a> 可点击、DOMPurify
  // 保留 href，点击路由与正文链接一致。
  it("fenced-code-block localhost link opens the preview pane", async () => {
    // 面板要开得出来需要足够宽度，否则 addTab 被拒（「空间不足，无法开启面板」）。
    await page.viewport(1100, 680);
    boot([
      MockDataGenerator.createAssistantMessage(
        "原型 v7 已改完并本地跑起来，请过目：\n\n```\nhttp://127.0.0.1:8097/\n```\n",
        "msg-a1",
      ),
    ]);

    const code = await waitForSelector(".markdown-content pre code");
    expect((code.textContent ?? "").trim()).toBe("http://127.0.0.1:8097/");

    const link = code.querySelector('a[href="http://127.0.0.1:8097/"]');
    expect(link).not.toBeNull();
    expect((link!.textContent ?? "").trim()).toBe("http://127.0.0.1:8097/");
    await userEvent.click(link!);
    await expect
      .poll(() => isVisible('[data-testid="preview-pane"]'))
      .toBe(true);
  });
});
