import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, screen, createEvent, within } from '@testing-library/react';
import React from 'react';
import { DesktopApp } from '../../src/components/DesktopApp';
import { ChatApp } from '../../src/components/ChatApp';
import { createMockVscode, sendCommand, renderChatApp } from './test-utils';

vi.mock('../../src/styles/DesktopApp.css', () => ({}));

/**
 * Conversation-level panel framework (FR-039/040/041/042): the header toggle
 * mounts/hides panel slots inside the desktop chat body, desktopTogglePanel
 * routes through the same handler, and desktopPanelState reports the toggle
 * state back to the host for the app-menu checkboxes.
 */

function renderDesktop(options?: { workdir?: string }) {
    const vscode = createMockVscode();
    render(<DesktopApp vscode={vscode} />);
    sendCommand('desktopWorkdirState', {
        workdir: options?.workdir,
        recentWorkdirs: options?.workdir ? [options.workdir] : [],
    });
    sendCommand('authStatusResponse', { isAuthenticated: true });
    return { vscode };
}

const panelStatePosts = (vscode: ReturnType<typeof createMockVscode>) =>
    vscode.postMessage.mock.calls
        .filter(([msg]) => msg.command === 'desktopPanelState')
        .map(([msg]) => msg.checked as string[]);

const lastPanelState = (vscode: ReturnType<typeof createMockVscode>) => {
    const posts = panelStatePosts(vscode);
    return posts[posts.length - 1];
};

afterEach(() => {
    delete window.waveHostType;
    // TerminalPane may inject the lazy chunk script; clean it up.
    document.head.querySelectorAll('script[src="./terminal.js"]').forEach((s) => s.remove());
});

describe('ChatApp desktop panel framework', () => {
    it('shows the header panel toggle on desktop but not in IDE hosts', () => {
        window.waveHostType = 'desktop';
        renderDesktop({ workdir: '/work/a' });
        expect(screen.getByTestId('panel-toggle-btn')).toBeInTheDocument();
    });

    it('hides the panel toggle outside the desktop host', () => {
        renderChatApp();
        expect(screen.queryByTestId('panel-toggle-btn')).not.toBeInTheDocument();
    });

    it('checking 差异 mounts the diff pane and requests the workspace diff', () => {
        window.waveHostType = 'desktop';
        const { vscode } = renderDesktop({ workdir: '/work/a' });
        fireEvent.click(screen.getByTestId('panel-toggle-btn'));
        fireEvent.click(screen.getByTestId('panel-toggle-item-diff'));

        expect(screen.getByTestId('diff-pane')).toBeInTheDocument();
        expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'desktopGetWorkspaceDiff' });
        // The menu stays open for consecutive multi-select.
        expect(screen.getByTestId('panel-toggle-menu')).toBeInTheDocument();
        expect(screen.getByTestId('panel-toggle-item-diff')).toHaveAttribute('aria-checked', 'true');
    });

    it('multiple panels stack side-by-side in the fixed Preview→Diff→Terminal order', () => {
        window.waveHostType = 'desktop';
        renderDesktop({ workdir: '/work/a' });
        fireEvent.click(screen.getByTestId('panel-toggle-btn'));
        fireEvent.click(screen.getByTestId('panel-toggle-item-terminal'));
        fireEvent.click(screen.getByTestId('panel-toggle-item-preview'));
        fireEvent.click(screen.getByTestId('panel-toggle-item-diff'));

        const slots = document.querySelectorAll('.desktop-panel-slot');
        expect(slots).toHaveLength(3);
        expect(slots[0].querySelector('[data-testid="preview-pane-empty"]')).not.toBeNull();
        expect(slots[1].querySelector('[data-testid="diff-pane"]')).not.toBeNull();
        expect(slots[2].querySelector('[data-testid="terminal-pane"]')).not.toBeNull();
    });

    it('unchecking hides the panel (display:none) but keeps it mounted', () => {
        window.waveHostType = 'desktop';
        renderDesktop({ workdir: '/work/a' });
        fireEvent.click(screen.getByTestId('panel-toggle-btn'));
        fireEvent.click(screen.getByTestId('panel-toggle-item-diff'));
        expect(screen.getByTestId('diff-pane')).toBeInTheDocument();

        fireEvent.click(screen.getByTestId('panel-toggle-item-diff'));
        expect(screen.getByTestId('diff-pane')).toBeInTheDocument(); // still mounted
        expect(screen.getByTestId('diff-pane').parentElement).toHaveStyle({ display: 'none' });
        expect(screen.getByTestId('panel-toggle-item-diff')).toHaveAttribute('aria-checked', 'false');

        // Re-check shows the same mounted instance.
        fireEvent.click(screen.getByTestId('panel-toggle-item-diff'));
        expect(screen.getByTestId('diff-pane').parentElement).not.toHaveStyle({ display: 'none' });
    });

    it('the panel close button unchecks it', () => {
        window.waveHostType = 'desktop';
        renderDesktop({ workdir: '/work/a' });
        fireEvent.click(screen.getByTestId('panel-toggle-btn'));
        fireEvent.click(screen.getByTestId('panel-toggle-item-diff'));
        fireEvent.mouseDown(document.body); // dismiss the menu

        fireEvent.click(screen.getByTestId('diff-close'));
        expect(screen.getByTestId('diff-pane').parentElement).toHaveStyle({ display: 'none' });
    });

    it('reports toggle state to the host via desktopPanelState', () => {
        window.waveHostType = 'desktop';
        const { vscode } = renderDesktop({ workdir: '/work/a' });
        // Initial report on mount.
        expect(lastPanelState(vscode)).toEqual([]);

        fireEvent.click(screen.getByTestId('panel-toggle-btn'));
        fireEvent.click(screen.getByTestId('panel-toggle-item-diff'));
        expect(lastPanelState(vscode)).toEqual(['diff']);

        fireEvent.click(screen.getByTestId('panel-toggle-item-terminal'));
        expect(lastPanelState(vscode)).toEqual(['diff', 'terminal']);

        fireEvent.click(screen.getByTestId('panel-toggle-item-diff'));
        expect(lastPanelState(vscode)).toEqual(['terminal']);
    });

    it('desktopTogglePanel from the host takes the same path as the menu', () => {
        window.waveHostType = 'desktop';
        const { vscode } = renderDesktop({ workdir: '/work/a' });
        sendCommand('desktopTogglePanel', { kind: 'diff' });
        expect(screen.getByTestId('diff-pane')).toBeInTheDocument();
        expect(lastPanelState(vscode)).toEqual(['diff']);

        sendCommand('desktopTogglePanel', { kind: 'diff' });
        expect(screen.getByTestId('diff-pane').parentElement).toHaveStyle({ display: 'none' });
        expect(lastPanelState(vscode)).toEqual([]);
    });

    it('disables diff/terminal without a workdir; preview stays available', () => {
        window.waveHostType = 'desktop';
        const { vscode } = renderDesktop();
        fireEvent.click(screen.getByTestId('panel-toggle-btn'));

        expect(screen.getByTestId('panel-toggle-item-diff')).toHaveAttribute('aria-disabled', 'true');
        expect(screen.getByTestId('panel-toggle-item-terminal')).toHaveAttribute('aria-disabled', 'true');
        expect(screen.getByTestId('panel-toggle-item-preview')).toHaveAttribute('aria-disabled', 'false');

        fireEvent.click(screen.getByTestId('panel-toggle-item-diff'));
        expect(screen.queryByTestId('diff-pane')).not.toBeInTheDocument();
        expect(vscode.postMessage).not.toHaveBeenCalledWith({ command: 'desktopGetWorkspaceDiff' });

        // Host-originated toggles hit the same guard.
        sendCommand('desktopTogglePanel', { kind: 'terminal' });
        expect(screen.queryByTestId('terminal-pane')).not.toBeInTheDocument();
    });

    it('refuses to open a panel that would squeeze the conversation below its minimum', () => {
        window.waveHostType = 'desktop';
        const rectSpy = vi
            .spyOn(Element.prototype, 'getBoundingClientRect')
            .mockReturnValue({ width: 500, right: 500 } as DOMRect);
        try {
            renderDesktop({ workdir: '/work/a' });
            fireEvent.click(screen.getByTestId('panel-toggle-btn'));
            fireEvent.click(screen.getByTestId('panel-toggle-item-diff'));
            expect(screen.queryByTestId('diff-pane')).not.toBeInTheDocument();
            expect(screen.getByTestId('desktop-panel-hint')).toHaveTextContent('空间不足');
        } finally {
            rectSpy.mockRestore();
        }
    });

    it('does not show the panel toggle when waveHostType is not desktop', () => {
        const vscode = createMockVscode();
        render(<ChatApp vscode={vscode} />);
        sendCommand('authStatusResponse', { isAuthenticated: true });
        expect(screen.queryByTestId('panel-toggle-btn')).not.toBeInTheDocument();
        expect(document.querySelector('.desktop-panel-slot')).toBeNull();
    });

    describe('panel second row', () => {
        afterEach(() => {
            vi.restoreAllMocks();
        });

        const bodyOf = (root: ParentNode = document) =>
            root.querySelector('.desktop-chat-body') as HTMLElement;

        const slotOf = (testid: string) =>
            screen.getByTestId(testid).closest('.desktop-panel-slot') as HTMLElement;

        function toolbarOf(testid: string): HTMLElement {
            const toolbar = screen.getByTestId(testid).querySelector('.preview-pane-toolbar');
            if (!toolbar) throw new Error(`no toolbar in ${testid}`);
            return toolbar as HTMLElement;
        }

        // jsdom reports 0 rects; the drag hit-testing measures the chat body.
        function mockChatBodyHeight(body: HTMLElement, height: number) {
            vi.spyOn(body, 'getBoundingClientRect').mockReturnValue({
                width: 1200, height, top: 0, left: 0, bottom: height, right: 1200, x: 0, y: 0, toJSON: () => ({}),
            });
        }

        function makeDataTransfer() {
            const store: Record<string, string> = {};
            return {
                get types() { return Object.keys(store); },
                setData: (type: string, value: string) => { store[type] = value; },
                getData: (type: string) => store[type] ?? '',
                effectAllowed: '',
                dropEffect: '',
            };
        }

        // jsdom lacks DragEvent, so fireEvent's dragOver drops clientY — build
        // the event manually to pin the pointer position.
        function dragOverBody(body: HTMLElement, dataTransfer: ReturnType<typeof makeDataTransfer>, clientY: number) {
            const event = createEvent.dragOver(body, { dataTransfer });
            Object.defineProperty(event, 'clientY', { value: clientY });
            fireEvent(body, event);
        }

        function openDiffPanel() {
            fireEvent.click(screen.getByTestId('panel-toggle-btn'));
            fireEvent.click(screen.getByTestId('panel-toggle-item-diff'));
        }

        // Starts a toolbar drag, targets the bottom band, and drops there.
        function dragDiffToRow2(bodyHeight = 800) {
            const body = bodyOf();
            mockChatBodyHeight(body, bodyHeight);
            const toolbar = toolbarOf('diff-pane');
            const dataTransfer = makeDataTransfer();
            fireEvent.dragStart(toolbar, { dataTransfer });
            dragOverBody(body, dataTransfer, bodyHeight - 10);
            fireEvent.drop(body, { dataTransfer });
            fireEvent.dragEnd(toolbar, { dataTransfer });
        }

        it('dragging a panel toolbar into the bottom band creates the second row', () => {
            window.waveHostType = 'desktop';
            renderDesktop({ workdir: '/work/a' });
            openDiffPanel();
            const body = bodyOf();
            mockChatBodyHeight(body, 800);

            const dataTransfer = makeDataTransfer();
            fireEvent.dragStart(toolbarOf('diff-pane'), { dataTransfer });
            dragOverBody(body, dataTransfer, 790);

            // VS Code-style overlay previews the row that would open.
            const zone = screen.getByTestId('desktop-panel-dropzone');
            expect(zone.style.top).toBe('520px');
            expect(zone.style.height).toBe('280px');

            fireEvent.drop(body, { dataTransfer });
            fireEvent.dragEnd(toolbarOf('diff-pane'), { dataTransfer });

            expect(slotOf('diff-pane').className).toContain('desktop-panel-slot--row-2');
            expect(screen.getByTestId('desktop-panel-row-separator')).toBeInTheDocument();
            expect(body.className).toContain('desktop-chat-body--two-rows');
            // Default row height: 35% of 800px, clamped to the row minimums.
            expect(body.style.getPropertyValue('--panel-row-height')).toBe('280px');
            expect(screen.queryByTestId('desktop-panel-dropzone')).not.toBeInTheDocument();
        });

        it('dragging within the panel’s own row shows no overlay and changes nothing', () => {
            window.waveHostType = 'desktop';
            renderDesktop({ workdir: '/work/a' });
            openDiffPanel();
            const body = bodyOf();
            mockChatBodyHeight(body, 800);

            const dataTransfer = makeDataTransfer();
            const toolbar = toolbarOf('diff-pane');
            fireEvent.dragStart(toolbar, { dataTransfer });
            dragOverBody(body, dataTransfer, 100);

            expect(screen.queryByTestId('desktop-panel-dropzone')).not.toBeInTheDocument();

            fireEvent.drop(body, { dataTransfer });
            fireEvent.dragEnd(toolbar, { dataTransfer });

            expect(slotOf('diff-pane').className).toContain('desktop-panel-slot--row-1');
            expect(screen.queryByTestId('desktop-panel-row-separator')).not.toBeInTheDocument();
        });

        it('dragging a second-row panel back up collapses the second row', () => {
            window.waveHostType = 'desktop';
            renderDesktop({ workdir: '/work/a' });
            openDiffPanel();
            dragDiffToRow2();
            expect(screen.getByTestId('desktop-panel-row-separator')).toBeInTheDocument();

            const body = bodyOf();
            const dataTransfer = makeDataTransfer();
            const toolbar = toolbarOf('diff-pane');
            fireEvent.dragStart(toolbar, { dataTransfer });
            dragOverBody(body, dataTransfer, 50);

            // The overlay covers the first row (everything above row 2 + separator).
            const zone = screen.getByTestId('desktop-panel-dropzone');
            expect(zone.style.top).toBe('0px');
            expect(zone.style.height).toBe('515px');

            fireEvent.drop(body, { dataTransfer });
            fireEvent.dragEnd(toolbar, { dataTransfer });

            expect(slotOf('diff-pane').className).toContain('desktop-panel-slot--row-1');
            expect(screen.queryByTestId('desktop-panel-row-separator')).not.toBeInTheDocument();
            expect(body.className).not.toContain('desktop-chat-body--two-rows');
        });

        it('the panel row separator drag resizes the second row with both clamps', () => {
            window.waveHostType = 'desktop';
            renderDesktop({ workdir: '/work/a' });
            openDiffPanel();
            dragDiffToRow2();
            const body = bodyOf();
            expect(body.style.getPropertyValue('--panel-row-height')).toBe('280px');

            const separator = screen.getByTestId('desktop-panel-row-separator');
            fireEvent.mouseDown(separator, { clientY: 500 });
            expect(separator.className).toContain('desktop-panel-row-separator--active');

            // Dragging up grows the panel row: 280 + (500-400) = 380.
            fireEvent.mouseMove(window, { clientY: 400 });
            expect(body.style.getPropertyValue('--panel-row-height')).toBe('380px');

            // Clamped at the panel-row minimum (160) when dragged far down.
            fireEvent.mouseMove(window, { clientY: 900 });
            expect(body.style.getPropertyValue('--panel-row-height')).toBe('160px');

            // Clamped at body - message minimum - separator (800-240-5=555).
            fireEvent.mouseMove(window, { clientY: 0 });
            expect(body.style.getPropertyValue('--panel-row-height')).toBe('555px');

            fireEvent.mouseUp(window);
            expect(separator.className).not.toContain('desktop-panel-row-separator--active');
        });

        it('refuses to create the second row when the chat body is too short', () => {
            window.waveHostType = 'desktop';
            renderDesktop({ workdir: '/work/a' });
            openDiffPanel();
            const body = bodyOf();
            mockChatBodyHeight(body, 300);

            const dataTransfer = makeDataTransfer();
            const toolbar = toolbarOf('diff-pane');
            fireEvent.dragStart(toolbar, { dataTransfer });
            dragOverBody(body, dataTransfer, 290);

            expect(screen.queryByTestId('desktop-panel-dropzone')).not.toBeInTheDocument();
            expect(screen.getByTestId('desktop-panel-hint')).toHaveTextContent('空间不足');

            fireEvent.drop(body, { dataTransfer });
            fireEvent.dragEnd(toolbar, { dataTransfer });

            expect(slotOf('diff-pane').className).toContain('desktop-panel-slot--row-1');
            expect(screen.queryByTestId('desktop-panel-row-separator')).not.toBeInTheDocument();
        });

        it('the panel group survives the pane moving across window rows', () => {
            window.waveHostType = 'desktop';
            renderDesktop({ workdir: '/work/a' });
            const session = (sessionId: string) => ({
                sessionId,
                title: sessionId,
                lastActiveAt: Date.now(),
                hasWorktree: false,
            });
            sendCommand('desktopSessionTree', {
                groups: [{ workdir: '/work/a', sessions: [session('s1'), session('s2')] }],
            });
            sendCommand('desktopPanes', {
                panes: [
                    { paneId: 'pane-cache-a', sessionId: 's1', row: 0 },
                    { paneId: 'pane-cache-b', sessionId: 's2', row: 1 },
                ],
                rowHeights: [0.5, 0.5],
                focusedPaneId: 'pane-cache-a',
            });

            // Open the diff panel in pane-cache-a and drag it into the second row.
            const paneA = screen.getByTestId('desktop-pane-pane-cache-a');
            fireEvent.click(within(paneA).getByTestId('panel-toggle-btn'));
            fireEvent.click(within(paneA).getByTestId('panel-toggle-item-diff'));
            const bodyA = paneA.querySelector('.desktop-chat-body') as HTMLElement;
            mockChatBodyHeight(bodyA, 800);
            const toolbar = paneA.querySelector('.preview-pane-toolbar') as HTMLElement;
            const dataTransfer = makeDataTransfer();
            fireEvent.dragStart(toolbar, { dataTransfer });
            dragOverBody(bodyA, dataTransfer, 790);
            fireEvent.drop(bodyA, { dataTransfer });
            fireEvent.dragEnd(toolbar, { dataTransfer });
            expect(within(paneA).getByTestId('desktop-panel-row-separator')).toBeInTheDocument();

            // The host moves pane-cache-a into window row 1 — the pane subtree
            // unmounts and remounts (React cannot reparent DOM nodes).
            sendCommand('desktopPanes', {
                panes: [
                    { paneId: 'pane-cache-b', sessionId: 's2', row: 0 },
                    { paneId: 'pane-cache-a', sessionId: 's1', row: 1 },
                ],
                rowHeights: [0.5, 0.5],
                focusedPaneId: 'pane-cache-a',
            });

            // The panel group migrated with the pane: diff still checked and
            // still in its second row.
            const paneA2 = screen.getByTestId('desktop-pane-pane-cache-a');
            const diff = within(paneA2).getByTestId('diff-pane');
            expect(diff.closest('.desktop-panel-slot')!.className).toContain('desktop-panel-slot--row-2');
            expect(within(paneA2).getByTestId('desktop-panel-row-separator')).toBeInTheDocument();
            const bodyA2 = paneA2.querySelector('.desktop-chat-body') as HTMLElement;
            expect(bodyA2.className).toContain('desktop-chat-body--two-rows');
            expect(bodyA2.style.getPropertyValue('--panel-row-height')).toBe('280px');
        });
    });
});
