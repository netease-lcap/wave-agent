import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
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
});
