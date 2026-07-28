import { test, expect } from '../utils/desktopTestHarness.js';
import { MessageInjector } from '../utils/messageInjector.js';
import { MockDataGenerator } from '../fixtures/mockData.js';

/**
 * Desktop preview pane + element picker screenshots.
 *
 * Chromium can't host a real Electron <webview>, so the guest side is faked:
 * the test stubs the element's IPC surface (send/loadURL/reload), dispatches
 * dom-ready + picker-ready events so the toggle can activate, and overlays a
 * hand-built mock prototype page inside .preview-pane-body. The mock comment
 * card mirrors pickerPreload.ts's real card (280px, panel background, head
 * with element summary + ×, textarea + accent send button).
 */
const DIR_A = '/Users/dev/projects/wave-agent';

const initialState = {
    messages: [],
    isStreaming: false,
    sessions: [],
    isAuthenticated: true,
    configurationData: {
        baseURL: 'https://api.anthropic.com/v1',
        model: 'claude-sonnet-4-20250514',
        fastModel: 'claude-haiku-4-20250514'
    },
    permissionMode: 'default'
};

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
    <div style="display:flex;align-items:center;">
      <div style="flex:1;color:var(--vscode-button-background);font-family:monospace;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="#mock-prototype button">button</div>
      <div style="background:var(--vscode-foreground);color:var(--vscode-panel-background,var(--vscode-editor-background));border-radius:50%;width:20px;height:20px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
        <svg viewBox="0 0 16 16" style="width:12px;height:12px;fill:currentColor;"><path transform="translate(2.65 2)" d="M10.7071 4.99999L5.70711 0H5L0 4.99999L0.707108 5.7071L4.85355 1.56066V12H5.85355V1.56066L9.99998 5.7071L10.7071 4.99999Z"/></svg>
      </div>
    </div>
  </div>
</div>`;

test.describe('Desktop Preview Pane Screenshots', () => {
    test('capture preview pane + element picker', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);
        await webviewPage.setViewportSize({ width: 1100, height: 680 });

        await injector.simulateExtensionMessage('setInitialState', initialState);
        await injector.simulateExtensionMessage('desktopWorkdirState', {
            workdir: DIR_A,
            recentWorkdirs: [DIR_A]
        });
        // ChatApp subscribes to window messages only after it mounts.
        await webviewPage.waitForSelector('[data-testid="chat-container"]', { timeout: 5000 });

        await injector.updateMessages([
            MockDataGenerator.createUserMessage('帮我做一个订单管理页面的原型，先跑起来看看效果', 'msg-u1'),
            MockDataGenerator.createAssistantMessage(
                '已用 Vite 创建原型并启动开发服务器，点击 [http://localhost:5173](http://localhost:5173) 在右侧预览。页面包含订单列表、状态筛选和待支付操作。',
                'msg-a1'
            )
        ]);

        // ── 1. Open the preview pane via the localhost link ──────────
        const link = webviewPage.locator('a[href="http://localhost:5173"]');
        await expect(link).toBeVisible();
        await link.click();
        await expect(webviewPage.getByTestId('preview-pane')).toBeVisible();

        // Stub the guest IPC surface and announce picker readiness.
        await webviewPage.evaluate(() => {
            const wv = document.querySelector('webview') as unknown as Record<string, unknown> & HTMLElement;
            wv.send = () => {};
            wv.loadURL = async () => {};
            wv.reload = () => {};
            wv.dispatchEvent(new Event('dom-ready'));
            const ipc = new Event('ipc-message') as Event & { channel: string; args: unknown[] };
            ipc.channel = 'wave-picker';
            ipc.args = [{ type: 'ready' }];
            wv.dispatchEvent(ipc);
        });

        // Overlay the mock prototype page.
        await webviewPage.evaluate((html) => {
            const body = document.querySelector('.preview-pane-body');
            body?.insertAdjacentHTML('beforeend', html);
        }, MOCK_PROTOTYPE_HTML);
        await expect(webviewPage.locator('#mock-prototype')).toBeVisible();
        await webviewPage.screenshot({ path: '../../docs/public/screenshots/desktop-preview-pane.png' });

        // ── 2. Picker active: toggle on + hover highlight outline ─────
        await webviewPage.getByTestId('preview-picker-toggle').click();
        await expect(webviewPage.getByTestId('preview-picker-toggle')).toHaveClass(/active/);
        await webviewPage.evaluate(() => {
            const chip = document.querySelector('#mock-chip-shipping') as HTMLElement | null;
            if (chip) {
                chip.style.outline = '2px solid var(--vscode-button-background)';
                chip.style.outlineOffset = '-2px';
            }
        });
        await webviewPage.screenshot({ path: '../../docs/public/screenshots/desktop-preview-picker.png' });

        // ── 3. Comment card pinned to the picked element ──────────────
        await webviewPage.evaluate((html) => {
            const body = document.querySelector('.preview-pane-body');
            const btn = document.querySelector('#mock-pay-btn');
            if (!body || !btn) return;
            const bodyRect = body.getBoundingClientRect();
            const btnRect = btn.getBoundingClientRect();
            const wrap = document.createElement('div');
            wrap.innerHTML = html;
            const card = wrap.firstElementChild as HTMLElement;
            const left = Math.min(
                btnRect.left - bodyRect.left,
                bodyRect.width - 280 - 14
            );
            card.style.left = `${Math.max(8, left)}px`;
            card.style.top = `${btnRect.bottom - bodyRect.top + 8}px`;
            body.appendChild(card);
        }, mockCardHtml('这里改成主要按钮样式，并加上加载中状态'));
        await expect(webviewPage.locator('#mock-picker-card')).toBeVisible();
        await webviewPage.screenshot({ path: '../../docs/public/screenshots/desktop-preview-comment.png' });
    });
});
