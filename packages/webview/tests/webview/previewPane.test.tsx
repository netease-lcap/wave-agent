import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, screen, act } from '@testing-library/react';
import React from 'react';
import { PreviewPane, formatPreviewComment, rewriteCommentUrl } from '../../src/components/PreviewPane';
import type { WebviewTagElement } from '../../src/components/PreviewPane';
import { DesktopApp } from '../../src/components/DesktopApp';
import { convertToMarkdown } from '../../src/utils/messageUtils';
import { createMockVscode, sendCommand } from './test-utils';
import { MockDataGenerator } from '../fixtures/mockData';

vi.mock('../../src/styles/DesktopApp.css', () => ({}));

type MockWebview = Omit<WebviewTagElement, 'send' | 'loadURL' | 'reload' | 'reloadIgnoringCache' | 'getURL'> & {
    send: ReturnType<typeof vi.fn>;
    loadURL: ReturnType<typeof vi.fn>;
    reload: ReturnType<typeof vi.fn>;
    reloadIgnoringCache: ReturnType<typeof vi.fn>;
    getURL: ReturnType<typeof vi.fn>;
};

function renderPane(options?: { url?: string; onClose?: () => void; onAddComment?: (text: string) => void; originalUrl?: string; onRetry?: () => void }) {
    const vscode = createMockVscode();
    const url = options?.url ?? 'http://localhost:5173/app';
    const onClose = options?.onClose ?? vi.fn();
    const onAddComment = options?.onAddComment ?? vi.fn();
    const originalUrl = options?.originalUrl;
    const onRetry = options?.onRetry;
    // Controlled-width harness: PreviewPane no longer owns its width state.
    const Harness = ({ url: u }: { url: string }) => {
        const [width, setWidth] = React.useState(420);
        return <PreviewPane url={u} vscode={vscode} onClose={onClose} width={width} onWidthChange={setWidth} maxWidth={716} onAddComment={onAddComment} originalUrl={originalUrl} onRetry={onRetry} />;
    };
    const result = render(<Harness url={url} />);
    const wv = result.container.querySelector('webview') as unknown as MockWebview;
    wv.send = vi.fn();
    wv.loadURL = vi.fn().mockResolvedValue(undefined);
    wv.reload = vi.fn();
    wv.reloadIgnoringCache = vi.fn();
    wv.getURL = vi.fn(() => url);
    const rerenderWithUrl = (u: string) => result.rerender(<Harness url={u} />);
    return { ...result, rerenderWithUrl, vscode, wv, url, onClose, onAddComment };
}

const fireDomReady = (wv: MockWebview) => fireEvent(wv, new Event('dom-ready'));
const firePickerReady = (wv: MockWebview) =>
    fireEvent(wv, Object.assign(new Event('ipc-message'), { channel: 'wave-picker', args: [{ type: 'ready' }] }));
const fireDidNavigate = (wv: MockWebview, url: string) =>
    fireEvent(wv, Object.assign(new Event('did-navigate'), { url }));
const fireInPageNavigate = (wv: MockWebview, url: string) =>
    fireEvent(wv, Object.assign(new Event('did-navigate-in-page'), { url }));
const firePickerSubmit = (wv: MockWebview, payload: Record<string, unknown>) =>
    fireEvent(wv, Object.assign(new Event('ipc-message'), { channel: 'wave-picker', args: [payload] }));

describe('PreviewPane', () => {
    it('loads the URL into the guest and shows it in the toolbar', () => {
        const { wv, url } = renderPane();
        expect(wv.getAttribute('src')).toBe(url);
        expect(screen.getByText(url)).toBeInTheDocument();
    });

    it('toggles the picker: activate sends palette, second click deactivates', () => {
        const { wv } = renderPane();
        fireDomReady(wv);
        firePickerReady(wv);

        fireEvent.click(screen.getByTestId('preview-picker-toggle'));
        expect(wv.send).toHaveBeenCalledWith('wave-picker', {
            action: 'activate',
            palette: expect.objectContaining({ accent: expect.any(String), inputBackground: expect.any(String) }),
        });
        expect(screen.getByTestId('preview-picker-toggle')).toHaveAttribute('aria-pressed', 'true');

        fireEvent.click(screen.getByTestId('preview-picker-toggle'));
        expect(wv.send).toHaveBeenLastCalledWith('wave-picker', { action: 'deactivate' });
        expect(screen.getByTestId('preview-picker-toggle')).toHaveAttribute('aria-pressed', 'false');
    });

    it('shows the unsupported hint when toggling before the guest preload is ready', () => {
        const { wv } = renderPane();
        fireDomReady(wv);
        // ready message never arrives → injection failed
        fireEvent.click(screen.getByTestId('preview-picker-toggle'));
        expect(wv.send).not.toHaveBeenCalled();
        expect(screen.getByTestId('preview-picker-unsupported')).toBeInTheDocument();
        expect(screen.getByTestId('preview-picker-toggle')).toHaveAttribute('aria-pressed', 'false');
        // recover once ready is received
        firePickerReady(wv);
        fireEvent.click(screen.getByTestId('preview-picker-toggle'));
        expect(wv.send).toHaveBeenCalledWith('wave-picker', expect.objectContaining({ action: 'activate' }));
        expect(screen.queryByTestId('preview-picker-unsupported')).not.toBeInTheDocument();
    });

    it('does not send picker messages before dom-ready', () => {
        const { wv } = renderPane();
        firePickerReady(wv);
        fireEvent.click(screen.getByTestId('preview-picker-toggle'));
        expect(wv.send).not.toHaveBeenCalled();
    });

    it('full navigation updates the URL and resets the picker', () => {
        const { wv } = renderPane();
        fireDomReady(wv);
        firePickerReady(wv);
        fireEvent.click(screen.getByTestId('preview-picker-toggle'));
        wv.send.mockClear();

        fireDidNavigate(wv, 'http://localhost:5173/other');

        expect(screen.getByText('http://localhost:5173/other')).toBeInTheDocument();
        expect(screen.getByTestId('preview-picker-toggle')).toHaveAttribute('aria-pressed', 'false');
        // Fresh document restarts the preload inactive — no deactivate needed.
        expect(wv.send).not.toHaveBeenCalled();
    });

    it('SPA in-page navigation actively deactivates the still-running preload', () => {
        const { wv } = renderPane();
        fireDomReady(wv);
        firePickerReady(wv);
        fireEvent.click(screen.getByTestId('preview-picker-toggle'));
        wv.send.mockClear();

        fireInPageNavigate(wv, 'http://localhost:5173/app#section');

        expect(screen.getByText('http://localhost:5173/app#section')).toBeInTheDocument();
        expect(wv.send).toHaveBeenCalledWith('wave-picker', { action: 'deactivate' });
        expect(screen.getByTestId('preview-picker-toggle')).toHaveAttribute('aria-pressed', 'false');
    });

    it('picker stays on across manual refresh (re-activates after dom-ready)', () => {
        const { wv } = renderPane();
        fireDomReady(wv);
        firePickerReady(wv);
        fireEvent.click(screen.getByTestId('preview-picker-toggle'));
        wv.send.mockClear();

        fireEvent.click(screen.getByTestId('preview-refresh'));
        expect(wv.reloadIgnoringCache).toHaveBeenCalled();
        fireDomReady(wv);
        firePickerReady(wv); // fresh document re-announces ready
        expect(wv.send).toHaveBeenCalledWith('wave-picker', expect.objectContaining({ action: 'activate' }));
    });

    it('shows an error state with retry on did-fail-load, ignores ERR_ABORTED (-3)', () => {
        const { wv } = renderPane();
        fireEvent(wv, Object.assign(new Event('did-fail-load'), {
            errorCode: -3, errorDescription: 'ERR_ABORTED', isMainFrame: true,
        }));
        expect(screen.queryByTestId('preview-error')).not.toBeInTheDocument();

        fireEvent(wv, Object.assign(new Event('did-fail-load'), {
            errorCode: -105, errorDescription: 'ERR_NAME_NOT_RESOLVED', isMainFrame: true,
        }));
        expect(screen.getByTestId('preview-error')).toHaveTextContent('ERR_NAME_NOT_RESOLVED');

        fireEvent.click(screen.getByTestId('preview-retry'));
        expect(wv.reloadIgnoringCache).toHaveBeenCalled();
        expect(screen.queryByTestId('preview-error')).not.toBeInTheDocument();
    });

    it('open-external posts the CURRENT guest URL (follows in-guest navigation)', () => {
        const { vscode, wv } = renderPane();
        fireDomReady(wv);
        fireDidNavigate(wv, 'http://localhost:5173/deep/page');

        fireEvent.click(screen.getByTestId('preview-open-external'));
        expect(vscode.postMessage).toHaveBeenCalledWith({
            command: 'openExternal',
            url: 'http://localhost:5173/deep/page',
        });
    });

    it('close button calls onClose', () => {
        const onClose = vi.fn();
        renderPane({ onClose });
        fireEvent.click(screen.getByTestId('preview-close'));
        expect(onClose).toHaveBeenCalled();
    });

    it('navigates via loadURL when a different URL arrives after dom-ready', () => {
        const { wv, rerenderWithUrl } = renderPane();
        fireDomReady(wv);
        rerenderWithUrl('http://localhost:3000/other');
        expect(wv.loadURL).toHaveBeenCalledWith('http://localhost:3000/other');
    });

    it('drag handle resizes within min/max bounds', () => {
        const { container } = renderPane();
        const pane = screen.getByTestId('preview-pane');
        const handle = container.querySelector('.preview-pane-drag-handle') as HTMLElement;
        // jsdom rects are all-zero; pin the aside's right edge at 1024.
        vi.spyOn(pane, 'getBoundingClientRect').mockReturnValue({ right: 1024 } as DOMRect);

        fireEvent.mouseDown(handle);
        fireEvent.mouseMove(window, { clientX: 624 }); // 1024 - 624 = 400
        expect(pane).toHaveStyle({ width: '400px' });
        fireEvent.mouseMove(window, { clientX: 950 }); // 74 → clamped to 320
        expect(pane).toHaveStyle({ width: '320px' });
        fireEvent.mouseMove(window, { clientX: 10 }); // 1014 → clamped to maxWidth 716
        expect(pane).toHaveStyle({ width: '716px' });
        fireEvent.mouseUp(window);
    });

    it('picker submit appends a formatted comment via onAddComment and keeps the picker active', () => {
        const { vscode, wv, onAddComment } = renderPane();
        fireDomReady(wv);
        firePickerReady(wv);
        fireEvent.click(screen.getByTestId('preview-picker-toggle'));
        expect(screen.getByTestId('preview-picker-toggle')).toHaveAttribute('aria-pressed', 'true');

        firePickerSubmit(wv, {
            type: 'submit',
            url: 'http://localhost:5173/login',
            selector: '#app > div > button.primary',
            summary: 'button.primary',
            text: '立即购买',
            comment: '这个按钮颜色太淡了',
        });

        expect(onAddComment).toHaveBeenCalledWith([
            '**预览评论** · http://localhost:5173/login',
            '`button.primary`「立即购买」 · `#app > div > button.primary`',
            '',
            '这个按钮颜色太淡了',
        ].join('\n'));
        // Nothing is sent to the agent directly — comments batch in the input.
        expect(vscode.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ command: 'sendMessage' }));
        // Picker stays active so the user can keep picking elements.
        expect(screen.getByTestId('preview-picker-toggle')).toHaveAttribute('aria-pressed', 'true');
    });

    it('ignores ipc messages on other channels', () => {
        const { vscode, wv } = renderPane();
        fireDomReady(wv);
        fireEvent(wv, Object.assign(new Event('ipc-message'), { channel: 'something-else', args: [{ type: 'submit', comment: 'x' }] }));
        expect(vscode.postMessage).not.toHaveBeenCalled();
    });

    it('rewrites picker comment URLs back to the original address (remote tunnel)', () => {
        const onAddComment = vi.fn();
        const onRetry = vi.fn();
        const { wv } = renderPane({
            url: 'http://127.0.0.1:5173/app',
            originalUrl: 'http://localhost:5173/app',
            onRetry,
            onAddComment,
        });
        fireDomReady(wv);
        firePickerReady(wv);
        fireEvent.click(screen.getByTestId('preview-picker-toggle'));

        firePickerSubmit(wv, {
            type: 'submit',
            url: 'http://127.0.0.1:5173/login?tab=2',
            selector: '#app > button',
            summary: 'button',
            text: '登录',
            comment: '按钮间距不对',
        });

        // The comment must reference the remote original URL (localhost:5173),
        // not the local tunnel address — the tunnel dies with the panel.
        expect(onAddComment).toHaveBeenCalledWith(expect.stringContaining('http://localhost:5173/login?tab=2'));
        expect(onAddComment).not.toHaveBeenCalledWith(expect.stringContaining('127.0.0.1'));
    });

    it('error retry re-establishes the forward when onRetry is provided (remote)', () => {
        const onRetry = vi.fn();
        const { wv } = renderPane({ url: 'http://127.0.0.1:5173/app', originalUrl: 'http://localhost:5173/app', onRetry });
        fireEvent(wv, Object.assign(new Event('did-fail-load'), {
            errorCode: -105, errorDescription: 'ERR_NAME_NOT_RESOLVED', isMainFrame: true,
        }));
        expect(screen.getByTestId('preview-error')).toHaveTextContent('ERR_NAME_NOT_RESOLVED');

        // Remote: retry means re-acquiring the tunnel (a plain reload would
        // hit the dead tunnel address again).
        fireEvent.click(screen.getByTestId('preview-retry'));
        expect(onRetry).toHaveBeenCalled();
        expect(screen.queryByTestId('preview-error')).not.toBeInTheDocument();
    });
});

describe('formatPreviewComment', () => {
    it('omits the 「text」 segment when the element has no inner text', () => {
        expect(formatPreviewComment({
            url: 'http://localhost:5173/',
            selector: '#app > div',
            summary: 'div.container',
            comment: '间距太大',
        })).toBe('**预览评论** · http://localhost:5173/\n`div.container` · `#app > div`\n\n间距太大');
    });
});

describe('rewriteCommentUrl', () => {
    const tunnelBase = 'http://127.0.0.1:5173/app';
    const originalBase = 'http://localhost:5173/app';

    it('rewrites a comment on the tunnel origin back to the original host', () => {
        expect(rewriteCommentUrl('http://127.0.0.1:5173/settings?tab=1#top', tunnelBase, originalBase)).toBe(
            'http://localhost:5173/settings?tab=1#top',
        );
    });

    it('keeps path/query/hash but swaps scheme, host, and port', () => {
        expect(rewriteCommentUrl('https://127.0.0.1:8443/admin/users', 'https://127.0.0.1:8443/', 'https://10.0.0.5:8443/admin')).toBe(
            'https://10.0.0.5:8443/admin/users',
        );
    });

    it('leaves URLs on other origins untouched', () => {
        expect(rewriteCommentUrl('http://127.0.0.1:9999/x', tunnelBase, originalBase)).toBe('http://127.0.0.1:9999/x');
        expect(rewriteCommentUrl('https://example.com/foo', tunnelBase, originalBase)).toBe('https://example.com/foo');
    });

    it('leaves invalid inputs untouched', () => {
        expect(rewriteCommentUrl('not a url', tunnelBase, originalBase)).toBe('not a url');
        expect(rewriteCommentUrl('http://127.0.0.1:5173/x', 'bad base', originalBase)).toBe('http://127.0.0.1:5173/x');
        expect(rewriteCommentUrl('http://127.0.0.1:5173/x', tunnelBase, 'bad base')).toBe('http://127.0.0.1:5173/x');
    });
});

describe('PreviewPane integration (DesktopApp)', () => {
    afterEach(() => {
        delete window.waveHostType;
    });

    it('clicking a localhost link in a message opens the preview pane', () => {
        window.waveHostType = 'desktop';
        render(<DesktopApp vscode={createMockVscode()} />);
        sendCommand('desktopWorkdirState', { workdir: '/work/a', recentWorkdirs: ['/work/a'] });
        sendCommand('authStatusResponse', { isAuthenticated: true });
        sendCommand('updateMessages', {
            messages: [MockDataGenerator.createAssistantMessage('原型在 [这里](http://localhost:5173/proto)')],
        });

        expect(screen.queryByTestId('preview-pane')).not.toBeInTheDocument();
        fireEvent.click(screen.getByText('这里'));

        const pane = screen.getByTestId('preview-pane');
        expect(pane).toBeInTheDocument();
        expect(pane.querySelector('webview')?.getAttribute('src')).toBe('http://localhost:5173/proto');

        fireEvent.click(screen.getByTestId('preview-close'));
        // Close = uncheck: the panel stays mounted (guest not reloaded), just hidden.
        const slot = screen.getByTestId('preview-pane').parentElement;
        expect(slot).toHaveClass('desktop-panel-slot');
        expect(slot).toHaveStyle({ display: 'none' });
    });

    it('picker comments land in the chat input (batched), nothing sent directly', () => {
        window.waveHostType = 'desktop';
        const vscode = createMockVscode();
        render(<DesktopApp vscode={vscode} />);
        sendCommand('desktopWorkdirState', { workdir: '/work/a', recentWorkdirs: ['/work/a'] });
        sendCommand('authStatusResponse', { isAuthenticated: true });
        sendCommand('updateMessages', {
            messages: [MockDataGenerator.createAssistantMessage('原型在 [这里](http://localhost:5173/proto)')],
        });
        fireEvent.click(screen.getByText('这里'));

        const wv = screen.getByTestId('preview-pane').querySelector('webview') as unknown as MockWebview;
        wv.send = vi.fn();
        wv.loadURL = vi.fn().mockResolvedValue(undefined);
        wv.reload = vi.fn();
        wv.reloadIgnoringCache = vi.fn();
        wv.getURL = vi.fn(() => 'http://localhost:5173/proto');
        fireDomReady(wv);
        firePickerReady(wv);
        fireEvent.click(screen.getByTestId('preview-picker-toggle'));

        const comment1 = {
            type: 'submit',
            url: 'http://localhost:5173/proto',
            selector: '#app > div > button.primary',
            summary: 'button.primary',
            text: '去支付',
            comment: '这里改成主要按钮样式',
        };
        firePickerSubmit(wv, comment1);

        const input = screen.getByTestId('message-input') as HTMLElement;
        expect(input.textContent).toContain('**预览评论** · http://localhost:5173/proto');
        expect(input.textContent).toContain('这里改成主要按钮样式');
        expect(document.activeElement).toBe(input);
        // Round-trip through the markdown the send path actually consumes.
        expect(convertToMarkdown(input).markdown).toBe(formatPreviewComment(comment1));

        // A second pick appends after the first instead of replacing it.
        firePickerSubmit(wv, { ...comment1, selector: '#app > div > input', summary: 'input', text: '', comment: '占位文字再明显一点' });
        expect(convertToMarkdown(input).markdown).toBe(
            formatPreviewComment(comment1) + '\n\n' + formatPreviewComment({ ...comment1, selector: '#app > div > input', summary: 'input', text: '', comment: '占位文字再明显一点' }),
        );

        // No direct sendMessage — the user reviews the batch and sends manually.
        expect(vscode.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ command: 'sendMessage' }));
        expect(vscode.postMessage).toHaveBeenCalledWith(expect.objectContaining({ command: 'updateInputContent' }));
        // Picker stays active for continuous picking.
        expect(screen.getByTestId('preview-picker-toggle')).toHaveAttribute('aria-pressed', 'true');
    });
});
