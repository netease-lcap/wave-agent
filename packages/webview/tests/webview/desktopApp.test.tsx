import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import React from 'react';
import { DesktopApp } from '../../src/components/DesktopApp';
import { createMockVscode, sendCommand } from './test-utils';

vi.mock('../../src/styles/DesktopApp.css', () => ({}));

function renderDesktopApp() {
    const vscode = createMockVscode();
    const result = render(<DesktopApp vscode={vscode} />);
    return { ...result, vscode };
}

describe('DesktopApp', () => {
    it('should post desktopReady on mount and show loading until workdir state arrives', () => {
        const { vscode } = renderDesktopApp();

        expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'desktopReady' });
        expect(screen.getByTestId('desktop-loading')).toBeInTheDocument();
    });

    it('should render the sidebar with a placeholder workdir name when no workdir is set', () => {
        renderDesktopApp();

        sendCommand('desktopWorkdirState', { recentWorkdirs: [] });

        // First launch: sidebar + chat render, no full-screen selector
        expect(screen.getByTestId('desktop-sidebar')).toBeInTheDocument();
        expect(screen.getByTestId('chat-container')).toBeInTheDocument();
        expect(screen.getByTestId('desktop-workdir')).toHaveTextContent('选择工作目录…');
        // New-session stays disabled until a workdir is picked
        expect(screen.getByTestId('desktop-new-session')).toBeDisabled();
    });

    it('should toggle the workdir dropdown and post desktopSelectWorkdir when clicking 浏览…', () => {
        const { vscode } = renderDesktopApp();
        sendCommand('desktopWorkdirState', { recentWorkdirs: [] });
        vscode.postMessage.mockClear();

        // Closed by default
        expect(screen.queryByTestId('desktop-workdir-menu')).not.toBeInTheDocument();

        fireEvent.click(screen.getByTestId('desktop-workdir'));
        expect(screen.getByTestId('desktop-workdir-menu')).toBeInTheDocument();

        fireEvent.click(screen.getByTestId('desktop-workdir-browse'));
        expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'desktopSelectWorkdir' });
        // Menu closes after selection
        expect(screen.queryByTestId('desktop-workdir-menu')).not.toBeInTheDocument();
    });

    it('should close the dropdown when clicking outside', () => {
        renderDesktopApp();
        sendCommand('desktopWorkdirState', { recentWorkdirs: [] });

        fireEvent.click(screen.getByTestId('desktop-workdir'));
        expect(screen.getByTestId('desktop-workdir-menu')).toBeInTheDocument();

        fireEvent.mouseDown(document.body);
        expect(screen.queryByTestId('desktop-workdir-menu')).not.toBeInTheDocument();
    });

    it('should render recent workdirs in the dropdown and post select/remove commands', () => {
        const { vscode } = renderDesktopApp();
        sendCommand('desktopWorkdirState', {
            workdir: '/home/user/project',
            recentWorkdirs: ['/home/user/project-a', '/home/user/project-b'],
        });
        vscode.postMessage.mockClear();

        fireEvent.click(screen.getByTestId('desktop-workdir'));
        const items = screen.getAllByTestId('desktop-workdir-recent-item');
        expect(items).toHaveLength(2);
        // Two-line entry: basename on top, parent path below
        expect(items[0].querySelector('.desktop-workdir-menu-name')).toHaveTextContent('project-a');
        expect(items[0].querySelector('.desktop-workdir-menu-parent')).toHaveTextContent('/home/user');

        fireEvent.click(items[0]);
        expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'desktopSelectRecentWorkdir', path: '/home/user/project-a' });

        // Selecting closed the menu — reopen to remove the other entry
        fireEvent.click(screen.getByTestId('desktop-workdir'));
        const removeBtns = screen.getAllByTestId('desktop-workdir-recent-remove');
        fireEvent.click(removeBtns[1]);
        expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'desktopRemoveRecentWorkdir', path: '/home/user/project-b' });
        // Remove click must not trigger selection
        expect(vscode.postMessage).not.toHaveBeenCalledWith({ command: 'desktopSelectRecentWorkdir', path: '/home/user/project-b' });
    });

    it('should render ChatApp with sidebar and hidden header session buttons when workdir is set', () => {
        const { vscode } = renderDesktopApp();

        sendCommand('desktopWorkdirState', { workdir: '/home/user/project', recentWorkdirs: [] });

        expect(screen.getByTestId('desktop-sidebar')).toBeInTheDocument();
        expect(screen.getByTestId('chat-container')).toBeInTheDocument();
        // Header session buttons are replaced by the sidebar
        expect(screen.queryByTestId('clear-chat-btn')).not.toBeInTheDocument();
        expect(screen.queryByTestId('history-btn')).not.toBeInTheDocument();
        expect(screen.getByTestId('more-btn')).toBeInTheDocument();
        // ChatApp still announces readiness to the host
        expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'webviewReady' });
    });

    it('should post clearChat from the sidebar new-session button', () => {
        const { vscode } = renderDesktopApp();
        sendCommand('desktopWorkdirState', { workdir: '/home/user/project', recentWorkdirs: [] });
        vscode.postMessage.mockClear();

        fireEvent.click(screen.getByTestId('desktop-new-session'));

        expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'clearChat' });
    });

    it('should update the workdir name and enable new-session when a new workdir state arrives', () => {
        renderDesktopApp();
        sendCommand('desktopWorkdirState', { recentWorkdirs: [] });
        expect(screen.getByTestId('desktop-workdir')).toHaveTextContent('选择工作目录…');
        expect(screen.getByTestId('desktop-new-session')).toBeDisabled();

        sendCommand('desktopWorkdirState', { workdir: '/home/user/other', recentWorkdirs: ['/home/user/other'] });

        expect(screen.getByTestId('desktop-workdir')).toHaveTextContent('other');
        expect(screen.getByTestId('desktop-new-session')).toBeEnabled();
        expect(screen.getByTestId('chat-container')).toBeInTheDocument();
    });

    describe('theme switching', () => {
        function sendInitialState(theme: { effective: 'light' | 'dark' }) {
            sendCommand('setInitialState', {
                messages: [],
                sessions: [],
                configurationData: {},
                pendingConfirmations: [],
                theme,
            });
        }

        it('applies the initial effective theme to <html data-theme> (FR-018)', () => {
            renderDesktopApp();
            sendCommand('desktopWorkdirState', { workdir: '/home/user/project', recentWorkdirs: [] });
            sendInitialState({ effective: 'dark' });

            expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
        });

        it('swaps <html data-theme> live on desktopThemeChange without reloading (FR-018)', () => {
            renderDesktopApp();
            sendCommand('desktopWorkdirState', { workdir: '/home/user/project', recentWorkdirs: [] });
            sendInitialState({ effective: 'dark' });
            expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

            sendCommand('desktopThemeChange', { effective: 'light' });

            expect(document.documentElement.getAttribute('data-theme')).toBe('light');
            // Chat is still mounted — no reload/rebuild
            expect(screen.getByTestId('chat-container')).toBeInTheDocument();
        });
    });
});
