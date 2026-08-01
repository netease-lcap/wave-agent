import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, fireEvent, screen, createEvent, within, act } from '@testing-library/react';
import React from 'react';
import { DesktopApp } from '../../src/components/DesktopApp';
import { ChatApp, prunePanelGroupCache } from '../../src/components/ChatApp';
import { EXIT_PLAN_MODE_TOOL_NAME } from 'wave-agent-sdk';
import { createMockVscode, sendCommand, renderChatApp, fireInput } from './test-utils';
import { MockDataGenerator } from '../fixtures/mockData';

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

beforeEach(() => {
    // The panel-group cache is module-level — isolate tests from each other.
    prunePanelGroupCache(new Set());
});

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

    it('the empty preview pane (no URL) resizes via its left-edge handle', () => {
        window.waveHostType = 'desktop';
        // jsdom reports 0 rects; pin a container width so panelMaxWidth stays
        // positive and the drag can actually widen the panel.
        const rectSpy = vi
            .spyOn(Element.prototype, 'getBoundingClientRect')
            .mockReturnValue({ width: 1024, right: 1024, left: 0 } as DOMRect);
        try {
            renderDesktop({ workdir: '/work/a' });
            fireEvent.click(screen.getByTestId('panel-toggle-btn'));
            fireEvent.click(screen.getByTestId('panel-toggle-item-preview'));

            const empty = screen.getByTestId('preview-pane-empty');
            expect(empty.style.width).toBe('420px'); // default width, no URL loaded yet
            // The empty state must carry the same drag affordance as loaded panels.
            expect(empty.querySelector('.preview-pane-drag-handle')).not.toBeNull();

            // Row 1 (widthFromLeft=false): width = rect.right - clientX.
            const handle = empty.querySelector('.preview-pane-drag-handle') as HTMLElement;
            fireEvent.mouseDown(handle);
            fireEvent.mouseMove(window, { clientX: 624 }); // 1024 - 624 = 400
            expect(empty.style.width).toBe('400px');
            fireEvent.mouseUp(window);
        } finally {
            rectSpy.mockRestore();
        }
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

    it('opens the panel in a fresh second row when the first row would squeeze the conversation below its minimum', () => {
        window.waveHostType = 'desktop';
        // 500px fits the 420px panel only without the 360px conversation
        // minimum beside it → row 1 refuses, row 2 takes it. The rect mock
        // reports no height, so the row-creation height gate is skipped.
        const rectSpy = vi
            .spyOn(Element.prototype, 'getBoundingClientRect')
            .mockReturnValue({ width: 500, right: 500 } as DOMRect);
        try {
            renderDesktop({ workdir: '/work/a' });
            fireEvent.click(screen.getByTestId('panel-toggle-btn'));
            fireEvent.click(screen.getByTestId('panel-toggle-item-diff'));
            expect(screen.getByTestId('diff-pane')).toBeInTheDocument();
            expect(screen.getByTestId('diff-pane').closest('.desktop-panel-slot')).toHaveClass(
                'desktop-panel-slot--row-2',
            );
            // A lone second-row panel must fill the pane width (spec: 第二行
            // 横贯分屏宽度), so the slot stretches instead of leaving a gap.
            expect(screen.getByTestId('diff-pane').closest('.desktop-panel-slot')).toHaveClass(
                'desktop-panel-slot--row-2-fill',
            );
            expect(screen.queryByTestId('desktop-panel-hint')).not.toBeInTheDocument();
        } finally {
            rectSpy.mockRestore();
        }
    });

    it('refuses to open a panel that fits in neither row', () => {
        window.waveHostType = 'desktop';
        // 300px is below the 420px default panel width even on a full-width
        // second row → nothing to overflow into.
        const rectSpy = vi
            .spyOn(Element.prototype, 'getBoundingClientRect')
            .mockReturnValue({ width: 300, right: 300 } as DOMRect);
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
        function dragToRow2(testid: string, bodyHeight = 800) {
            const body = bodyOf();
            mockChatBodyHeight(body, bodyHeight);
            const toolbar = toolbarOf(testid);
            const dataTransfer = makeDataTransfer();
            fireEvent.dragStart(toolbar, { dataTransfer });
            dragOverBody(body, dataTransfer, bodyHeight - 10);
            fireEvent.drop(body, { dataTransfer });
            fireEvent.dragEnd(toolbar, { dataTransfer });
        }

        const dragDiffToRow2 = (bodyHeight = 800) => dragToRow2('diff-pane', bodyHeight);

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

        it('only the last second-row panel grows to fill the row width', () => {
            window.waveHostType = 'desktop';
            renderDesktop({ workdir: '/work/a' });
            fireEvent.click(screen.getByTestId('panel-toggle-btn'));
            fireEvent.click(screen.getByTestId('panel-toggle-item-diff'));
            fireEvent.click(screen.getByTestId('panel-toggle-item-terminal'));
            // Drag both into the second row; the fixed order is Preview→Diff→Terminal,
            // so terminal is the last and should absorb the remaining width.
            dragToRow2('diff-pane');
            dragToRow2('terminal-pane');
            const diffSlot = slotOf('diff-pane');
            const termSlot = slotOf('terminal-pane');
            expect(diffSlot.className).toContain('desktop-panel-slot--row-2');
            expect(termSlot.className).toContain('desktop-panel-slot--row-2');
            expect(diffSlot.className).not.toContain('desktop-panel-slot--row-2-fill');
            expect(termSlot.className).toContain('desktop-panel-slot--row-2-fill');
        });

        it('the second-row layout is remembered per session across switches', () => {
            window.waveHostType = 'desktop';
            renderDesktop({ workdir: '/work/a' });
            // Sessions must exist in the sidebar tree — the prune keeps panel
            // groups only for live panes and tree sessions.
            sendCommand('desktopSessionTree', {
                groups: [
                    {
                        workdir: '/work/a',
                        sessions: ['s1', 's2'].map((sessionId) => ({
                            sessionId,
                            title: sessionId,
                            lastActiveAt: Date.now(),
                            hasWorktree: false,
                        })),
                    },
                ],
            });
            sendCommand('desktopPanes', {
                panes: [{ paneId: 'pane-1', sessionId: 's1', row: 0 }],
                focusedPaneId: 'pane-1',
            });
            openDiffPanel();
            dragDiffToRow2();
            expect(slotOf('diff-pane').className).toContain('desktop-panel-slot--row-2');

            // Switch to another session: its (empty) group swaps in — no
            // panels, no second row.
            sendCommand('desktopPanes', {
                panes: [{ paneId: 'pane-1', sessionId: 's2', row: 0 }],
                focusedPaneId: 'pane-1',
            });
            expect(screen.queryByTestId('diff-pane')).not.toBeInTheDocument();
            expect(screen.queryByTestId('desktop-panel-row-separator')).not.toBeInTheDocument();

            // Switching back restores the diff panel in its second row with
            // the same height.
            sendCommand('desktopPanes', {
                panes: [{ paneId: 'pane-1', sessionId: 's1', row: 0 }],
                focusedPaneId: 'pane-1',
            });
            expect(slotOf('diff-pane').className).toContain('desktop-panel-slot--row-2');
            expect(screen.getByTestId('desktop-panel-row-separator')).toBeInTheDocument();
            expect(bodyOf().style.getPropertyValue('--panel-row-height')).toBe('280px');
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

        // Two-row mode compresses the message row; an inline ConfirmationDialog
        // (plan preview / permission / AskUserQuestions) can grow taller than the
        // compressed first row. The input area must clamp and the dialog body must
        // scroll instead of overflowing onto the second-row panels.
        it('two-row mode clamps an over-tall inline ConfirmationDialog with an inner scroller', async () => {
            window.waveHostType = 'desktop';
            renderDesktop({ workdir: '/work/a' });
            openDiffPanel();
            dragDiffToRow2();
            expect(bodyOf().className).toContain('desktop-chat-body--two-rows');

            await act(async () => {
                sendCommand('showConfirmation', {
                    confirmationId: 'confirm_two_row',
                    toolName: EXIT_PLAN_MODE_TOOL_NAME,
                    confirmationType: '计划待确认',
                    planContent: '## Plan\n' + '- step\n'.repeat(120),
                });
            });

            const inputArea = document.querySelector('.input-area-container') as HTMLElement;
            expect(inputArea).not.toBeNull();
            expect(inputArea.className).toContain('input-area-container--confirm');
            const inner = document.querySelector('.confirmation-dialog-inner') as HTMLElement;
            expect(inner).toBeInTheDocument();
        });
    });
});

/**
 * Panel groups follow the session, not the pane: switching the session bound
 * to a pane swaps the whole panel group (checked set, layout, preview URL),
 * and switching back restores it. A pane's new-session state has its own
 * bucket that migrates to the session id once the first message binds one.
 */
describe('session-level panel groups', () => {
    const session = (sessionId: string) => ({
        sessionId,
        title: sessionId,
        lastActiveAt: Date.now(),
        hasWorktree: false,
    });
    const pushPanes = (sessionId?: string) =>
        sendCommand('desktopPanes', {
            panes: [{ paneId: 'pane-1', sessionId, row: 0 }],
            focusedPaneId: 'pane-1',
        });
    const pushTree = (ids: string[]) =>
        sendCommand('desktopSessionTree', {
            groups: [{ workdir: '/work/a', sessions: ids.map(session) }],
        });
    const openPanel = (kind: string) => {
        fireEvent.click(screen.getByTestId('panel-toggle-btn'));
        fireEvent.click(screen.getByTestId(`panel-toggle-item-${kind}`));
        fireEvent.mouseDown(document.body); // dismiss the menu
    };

    it('switching sessions swaps the panel group; switching back restores it', () => {
        window.waveHostType = 'desktop';
        const { vscode } = renderDesktop({ workdir: '/work/a' });
        pushTree(['s1', 's2']);
        pushPanes('s1');
        openPanel('diff');
        expect(screen.getByTestId('diff-pane')).toBeInTheDocument();
        expect(lastPanelState(vscode)).toEqual(['diff']);

        // s2 has no remembered group — the diff panel must not leak into it.
        pushPanes('s2');
        expect(screen.queryByTestId('diff-pane')).not.toBeInTheDocument();
        expect(lastPanelState(vscode)).toEqual([]);

        // s2 gets its own group; the two sessions coexist independently.
        openPanel('terminal');
        expect(screen.getByTestId('terminal-pane')).toBeInTheDocument();
        expect(lastPanelState(vscode)).toEqual(['terminal']);

        pushPanes('s1');
        expect(screen.getByTestId('diff-pane')).toBeInTheDocument();
        expect(screen.queryByTestId('terminal-pane')).not.toBeInTheDocument();
        expect(lastPanelState(vscode)).toEqual(['diff']);

        pushPanes('s2');
        expect(screen.getByTestId('terminal-pane')).toBeInTheDocument();
        expect(screen.queryByTestId('diff-pane')).not.toBeInTheDocument();
        expect(lastPanelState(vscode)).toEqual(['terminal']);
    });

    it('the new-session bucket migrates to the session id bound by the first message', async () => {
        window.waveHostType = 'desktop';
        renderDesktop({ workdir: '/work/a' });
        pushTree(['s1', 's2']);
        pushPanes(undefined); // new-session state, no session bound
        openPanel('diff');
        expect(screen.getByTestId('diff-pane')).toBeInTheDocument();

        // Send the first message — this is what makes the coming session bind
        // a continuation of the new-session state (vs a sidebar switch).
        const input = screen.getByTestId('message-input');
        act(() => {
            input.textContent = 'hi';
        });
        await fireInput(input, { data: 'hi', inputType: 'insertText' });
        act(() => {
            fireEvent.click(screen.getByTestId('send-btn'));
        });

        // The message binds session s1: the panel setup carries over.
        pushPanes('s1');
        expect(screen.getByTestId('diff-pane')).toBeInTheDocument();

        // ...and is remembered under that session from then on.
        pushPanes('s2');
        expect(screen.queryByTestId('diff-pane')).not.toBeInTheDocument();
        pushPanes('s1');
        expect(screen.getByTestId('diff-pane')).toBeInTheDocument();
    });

    it('the new-session bucket does not leak into an existing session', () => {
        window.waveHostType = 'desktop';
        renderDesktop({ workdir: '/work/a' });
        pushPanes(undefined);
        openPanel('diff');

        // Switching to an existing session swaps in its own (empty) group…
        pushPanes('s2');
        expect(screen.queryByTestId('diff-pane')).not.toBeInTheDocument();

        // …and returning to the new-session state restores the bucket.
        pushPanes(undefined);
        expect(screen.getByTestId('diff-pane')).toBeInTheDocument();
    });

    it('a deleted session forgets its panel group', () => {
        window.waveHostType = 'desktop';
        renderDesktop({ workdir: '/work/a' });
        pushTree(['s1', 's2']);
        pushPanes('s1');
        openPanel('diff');

        // While s1 lives in the sidebar tree its group survives switches.
        pushPanes('s2');
        pushPanes('s1');
        expect(screen.getByTestId('diff-pane')).toBeInTheDocument();

        // Deleting s1 (gone from the tree, no pane bound to it) prunes it.
        pushPanes('s2');
        pushTree(['s2']);
        pushPanes('s1');
        expect(screen.queryByTestId('diff-pane')).not.toBeInTheDocument();
    });
});

/**
 * Remote preview + SSH port forwarding (spec scenarios 15-18): clicking a
 * localhost link in a remote session requests an ssh -N -L forward from the
 * main process, the rewritten reply loads in the preview pane, re-clicking the
 * same link is a no-op (no duplicate tunnel), failures surface an actionable
 * error with a retry that re-establishes the forward, and closing the panel /
 * switching host / unmounting releases the tunnel so no ssh process leaks.
 */
describe('remote preview port forwarding', () => {
    const session = (sessionId: string) => ({
        sessionId,
        title: sessionId,
        lastActiveAt: Date.now(),
        hasWorktree: false,
    });
    const pushRemotePane = () =>
        sendCommand('desktopPanes', {
            panes: [{ paneId: 'pane-1', sessionId: 's1', row: 0, host: 'prod' }],
            focusedPaneId: 'pane-1',
        });
    const openLink = () => {
        sendCommand('updateMessages', {
            paneId: 'pane-1',
            messages: [MockDataGenerator.createAssistantMessage('服务在 [这里](http://localhost:5173/app)')],
        });
        fireEvent.click(screen.getByText('这里'));
    };
    const forwardPosts = (vscode: ReturnType<typeof createMockVscode>) =>
        vscode.postMessage.mock.calls
            .filter(([msg]) => msg.command === 'desktopForwardPort')
            .map(([msg]) => msg);
    const releasePosts = (vscode: ReturnType<typeof createMockVscode>) =>
        vscode.postMessage.mock.calls
            .filter(([msg]) => msg.command === 'desktopReleasePort')
            .map(([msg]) => msg);

    it('clicking a localhost link in a remote session requests a forward on the pane host', () => {
        window.waveHostType = 'desktop';
        const { vscode } = renderDesktop({ workdir: '/work/a' });
        sendCommand('desktopSessionTree', { groups: [{ workdir: '/work/a', sessions: [session('s1')] }] });
        pushRemotePane();
        openLink();

        // The pane's own host is used (not the local fallback), and the preview
        // panel opens in its connecting stub while the tunnel comes up.
        expect(forwardPosts(vscode)).toEqual([
            { command: 'desktopForwardPort', host: 'prod', url: 'http://localhost:5173/app', requestId: 'fwd-1', paneId: 'pane-1' },
        ]);
        expect(screen.getByTestId('preview-pane-empty')).toBeInTheDocument();
        expect(screen.getByTestId('preview-pane-empty')).toHaveTextContent('点击消息或终端中的 localhost 链接加载预览');
    });

    it('the forward reply loads the rewritten address in the preview pane', () => {
        window.waveHostType = 'desktop';
        const { vscode } = renderDesktop({ workdir: '/work/a' });
        sendCommand('desktopSessionTree', { groups: [{ workdir: '/work/a', sessions: [session('s1')] }] });
        pushRemotePane();
        openLink();

        sendCommand('desktopForwardPortResult', {
            paneId: 'pane-1',
            requestId: 'fwd-1',
            url: 'http://127.0.0.1:5173/app',
            originalUrl: 'http://localhost:5173/app',
        });

        const pane = screen.getByTestId('preview-pane');
        expect(pane.querySelector('webview')?.getAttribute('src')).toBe('http://127.0.0.1:5173/app');
        expect(screen.queryByTestId('preview-pane-empty')).not.toBeInTheDocument();
        // The local tunnel is only meaningful on this host — never cached
        // against the session for later restoration.
        expect(vscode.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({ command: 'desktopPanelState', checked: expect.arrayContaining(['preview']) }),
        );
    });

    it('clicking the same link again does not re-establish the forward', () => {
        window.waveHostType = 'desktop';
        const { vscode } = renderDesktop({ workdir: '/work/a' });
        sendCommand('desktopSessionTree', { groups: [{ workdir: '/work/a', sessions: [session('s1')] }] });
        pushRemotePane();
        openLink();
        sendCommand('desktopForwardPortResult', {
            paneId: 'pane-1',
            requestId: 'fwd-1',
            url: 'http://127.0.0.1:5173/app',
            originalUrl: 'http://localhost:5173/app',
        });

        fireEvent.click(screen.getByText('这里'));

        expect(forwardPosts(vscode)).toHaveLength(1);
    });

    it('a failed forward shows an actionable error; retry re-acquires and loads', () => {
        window.waveHostType = 'desktop';
        const { vscode } = renderDesktop({ workdir: '/work/a' });
        sendCommand('desktopSessionTree', { groups: [{ workdir: '/work/a', sessions: [session('s1')] }] });
        pushRemotePane();
        openLink();

        sendCommand('desktopForwardPortResult', {
            paneId: 'pane-1',
            requestId: 'fwd-1',
            error: '转发建立超时：无法连接远端主机 prod',
        });

        const empty = screen.getByTestId('preview-pane-empty');
        expect(empty).toHaveTextContent('远程预览加载失败：转发建立超时：无法连接远端主机 prod');
        fireEvent.click(screen.getByTestId('preview-forward-retry'));

        // Retry is a fresh acquire (new requestId), not a silent reload.
        expect(forwardPosts(vscode)).toHaveLength(2);
        expect(forwardPosts(vscode)[1]).toMatchObject({ host: 'prod', requestId: 'fwd-2' });

        sendCommand('desktopForwardPortResult', {
            paneId: 'pane-1',
            requestId: 'fwd-2',
            url: 'http://127.0.0.1:5173/app',
            originalUrl: 'http://localhost:5173/app',
        });
        const pane = screen.getByTestId('preview-pane');
        expect(pane.querySelector('webview')?.getAttribute('src')).toBe('http://127.0.0.1:5173/app');
        expect(screen.queryByTestId('preview-pane-empty')).not.toBeInTheDocument();
    });

    it('closing the preview panel releases the forward (no orphan ssh)', () => {
        window.waveHostType = 'desktop';
        const { vscode } = renderDesktop({ workdir: '/work/a' });
        sendCommand('desktopSessionTree', { groups: [{ workdir: '/work/a', sessions: [session('s1')] }] });
        pushRemotePane();
        openLink();

        fireEvent.click(screen.getByTestId('preview-close'));

        expect(releasePosts(vscode)).toEqual([
            { command: 'desktopReleasePort', host: 'prod', remotePort: 5173, paneId: 'pane-1' },
        ]);
        // Closing must not re-request the tunnel.
        expect(forwardPosts(vscode)).toHaveLength(1);
    });

    it('switching host releases the forward and clears the preview', () => {
        window.waveHostType = 'desktop';
        const { vscode } = renderDesktop({ workdir: '/work/a' });
        sendCommand('desktopSessionTree', { groups: [{ workdir: '/work/a', sessions: [session('s1')] }] });
        pushRemotePane();
        openLink();
        sendCommand('desktopForwardPortResult', {
            paneId: 'pane-1',
            requestId: 'fwd-1',
            url: 'http://127.0.0.1:5173/app',
            originalUrl: 'http://localhost:5173/app',
        });
        expect(screen.getByTestId('preview-pane')).toBeInTheDocument();

        // Host switch (remote → local): the tunnel is meaningless on the new
        // host, so it is released and the forwarded URL is dropped.
        sendCommand('desktopPanes', {
            panes: [{ paneId: 'pane-1', sessionId: 's1', row: 0, host: 'local' }],
            focusedPaneId: 'pane-1',
        });

        expect(releasePosts(vscode)).toEqual([
            { command: 'desktopReleasePort', host: 'prod', remotePort: 5173, paneId: 'pane-1' },
        ]);
        expect(screen.queryByTestId('preview-pane')).not.toBeInTheDocument();
        expect(screen.getByTestId('preview-pane-empty')).toBeInTheDocument();
    });

    it('a stale forward reply for a released request is dropped', () => {
        window.waveHostType = 'desktop';
        const { vscode } = renderDesktop({ workdir: '/work/a' });
        sendCommand('desktopSessionTree', { groups: [{ workdir: '/work/a', sessions: [session('s1')] }] });
        pushRemotePane();
        openLink();
        // Fail, then retry: the current request is now fwd-2.
        sendCommand('desktopForwardPortResult', { paneId: 'pane-1', requestId: 'fwd-1', error: '连接失败' });
        fireEvent.click(screen.getByTestId('preview-forward-retry'));
        expect(forwardPosts(vscode)[1].requestId).toBe('fwd-2');

        // A late fwd-1 reply (for the superseded attempt) must not load a URL
        // or resurrect the error behind the retry's back — it is dropped, and
        // the stub stays in its connecting state awaiting the fwd-2 result.
        sendCommand('desktopForwardPortResult', {
            paneId: 'pane-1',
            requestId: 'fwd-1',
            url: 'http://127.0.0.1:5173/app',
            originalUrl: 'http://localhost:5173/app',
        });
        expect(screen.queryByTestId('preview-pane')).not.toBeInTheDocument();
        expect(screen.getByTestId('preview-pane-empty')).toHaveTextContent('点击消息或终端中的 localhost 链接加载预览');
    });
});
