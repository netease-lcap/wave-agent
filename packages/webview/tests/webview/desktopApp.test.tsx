import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import React from 'react';
import { DesktopApp } from '../../src/components/DesktopApp';
import { createMockVscode, sendCommand } from './test-utils';
import { MockDataGenerator } from '../fixtures/mockData';

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

    it('should render sidebar with new-chat button only (no session list), and the workdir selector inside the input', () => {
        renderDesktopApp();

        sendCommand('desktopWorkdirState', { recentWorkdirs: [] });

        expect(screen.getByTestId('desktop-sidebar')).toBeInTheDocument();
        expect(screen.getByTestId('desktop-new-session')).toBeInTheDocument();
        // Session list is removed from the sidebar
        expect(screen.queryByPlaceholderText('搜索关键词')).not.toBeInTheDocument();
        // Workdir selector lives inside the input, showing the placeholder
        expect(screen.getByTestId('input-workdir-row')).toBeInTheDocument();
        expect(screen.getByTestId('desktop-workdir')).toHaveTextContent('选择工作目录…');
        // New-chat stays disabled until a workdir is picked
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

    it('should hide the workdir selector once the conversation starts', () => {
        renderDesktopApp();
        sendCommand('desktopWorkdirState', { workdir: '/home/user/project', recentWorkdirs: [] });

        // New-session state: selector visible inside the input
        expect(screen.getByTestId('input-workdir-row')).toBeInTheDocument();

        sendCommand('updateMessages', { messages: [MockDataGenerator.createUserMessage('hi')] });

        // Conversation started: selector gone, session list stays out of the sidebar
        expect(screen.queryByTestId('input-workdir-row')).not.toBeInTheDocument();
        expect(screen.queryByTestId('desktop-workdir')).not.toBeInTheDocument();
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

    it('should post clearChat from the sidebar new-chat button', () => {
        const { vscode } = renderDesktopApp();
        sendCommand('desktopWorkdirState', { workdir: '/home/user/project', recentWorkdirs: [] });
        vscode.postMessage.mockClear();

        fireEvent.click(screen.getByTestId('desktop-new-session'));

        expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'clearChat' });
    });

    it('should update the workdir name and enable new-chat when a new workdir state arrives', () => {
        renderDesktopApp();
        sendCommand('desktopWorkdirState', { recentWorkdirs: [] });
        expect(screen.getByTestId('desktop-workdir')).toHaveTextContent('选择工作目录…');
        expect(screen.getByTestId('desktop-new-session')).toBeDisabled();

        sendCommand('desktopWorkdirState', { workdir: '/home/user/other', recentWorkdirs: ['/home/user/other'] });

        expect(screen.getByTestId('desktop-workdir')).toHaveTextContent('other');
        expect(screen.getByTestId('desktop-new-session')).toBeEnabled();
        expect(screen.getByTestId('chat-container')).toBeInTheDocument();
    });

    it('should disable the input area when no workdir is selected, and enable it once a workdir arrives', () => {
        renderDesktopApp();
        sendCommand('desktopWorkdirState', { recentWorkdirs: [] });

        expect(screen.getByTestId('message-input')).toHaveAttribute('contenteditable', 'false');
        expect(screen.getByTestId('send-btn')).toBeDisabled();
        expect(screen.getByLabelText('添加')).toBeDisabled();
        expect(screen.getByLabelText('快捷指令')).toBeDisabled();
        expect(screen.getByLabelText('权限模式')).toBeDisabled();

        sendCommand('desktopWorkdirState', { workdir: '/home/user/project', recentWorkdirs: [] });

        expect(screen.getByTestId('message-input')).toHaveAttribute('contenteditable', 'true');
        expect(screen.getByLabelText('添加')).toBeEnabled();
        expect(screen.getByLabelText('快捷指令')).toBeEnabled();
        expect(screen.getByLabelText('权限模式')).toBeEnabled();
    });

    describe('session tree (FR-020)', () => {
        const session = (sessionId: string, title: string) => ({
            sessionId,
            title,
            lastActiveAt: Date.now(),
            hasWorktree: false,
        });

        const groupHeader = (workdir: string) =>
            screen.getByTestId(`desktop-session-group-${workdir}`).querySelector('.desktop-session-group-header') as HTMLElement;

        it('renders one group per recent directory, current workdir expanded by default', () => {
            renderDesktopApp();
            sendCommand('desktopWorkdirState', { workdir: '/work/a', recentWorkdirs: ['/work/a', '/work/b'] });
            sendCommand('desktopSessionTree', {
                groups: [
                    { workdir: '/work/a', sessions: [session('s1', 'hello a')] },
                    { workdir: '/work/b', sessions: [session('s2', 'hello b')] },
                ],
            });

            // Current workdir's group expanded: session visible
            expect(screen.getByTestId('desktop-session-item-s1')).toBeInTheDocument();
            // Other group collapsed by default: session hidden
            expect(screen.queryByTestId('desktop-session-item-s2')).not.toBeInTheDocument();
            // Group headers show directory basenames
            expect(screen.getByTestId('desktop-session-group-/work/a')).toHaveTextContent('a');
            expect(screen.getByTestId('desktop-session-group-/work/b')).toHaveTextContent('b');
        });

        it('toggles a group on header click', () => {
            renderDesktopApp();
            sendCommand('desktopWorkdirState', { workdir: '/work/a', recentWorkdirs: ['/work/a', '/work/b'] });
            sendCommand('desktopSessionTree', {
                groups: [
                    { workdir: '/work/a', sessions: [session('s1', 'hello a')] },
                    { workdir: '/work/b', sessions: [session('s2', 'hello b')] },
                ],
            });

            // Expand the collapsed group
            fireEvent.click(groupHeader('/work/b'));
            expect(screen.getByTestId('desktop-session-item-s2')).toBeInTheDocument();

            // Collapse the default-expanded group
            fireEvent.click(groupHeader('/work/a'));
            expect(screen.queryByTestId('desktop-session-item-s1')).not.toBeInTheDocument();
        });

        it('posts desktopSelectSession with the group workdir when a session is clicked', () => {
            const { vscode } = renderDesktopApp();
            sendCommand('desktopWorkdirState', { workdir: '/work/a', recentWorkdirs: ['/work/a'] });
            sendCommand('desktopSessionTree', {
                groups: [{ workdir: '/work/a', sessions: [session('s1', 'hello a')] }],
            });
            vscode.postMessage.mockClear();

            fireEvent.click(screen.getByTestId('desktop-session-item-s1'));

            expect(vscode.postMessage).toHaveBeenCalledWith({
                command: 'desktopSelectSession',
                workdir: '/work/a',
                sessionId: 's1',
            });
        });

        it('shows a running dot on the streaming current session and marks it current', () => {
            renderDesktopApp();
            sendCommand('desktopWorkdirState', { workdir: '/work/a', recentWorkdirs: ['/work/a'] });
            sendCommand('desktopSessionTree', {
                groups: [{ workdir: '/work/a', sessions: [session('s1', 'hello a'), session('s2', 'hello again')] }],
            });
            sendCommand('updateCurrentSession', { session: { id: 's1', sessionType: 'main', workdir: '/work/a', createdAt: '2026-07-20T00:00:00.000Z', lastActiveAt: '2026-07-21T00:00:00.000Z', latestTotalTokens: 0, firstMessage: 'hello a' } });
            sendCommand('startStreaming', {});

            const current = screen.getByTestId('desktop-session-item-s1');
            expect(current.querySelector('.desktop-session-dot--running')).not.toBeNull();
            expect(current.className).toContain('desktop-session-item--current');
            expect(screen.getByTestId('desktop-session-item-s2').querySelector('.desktop-session-dot--running')).toBeNull();
        });

        it('shows 无会话 for an expanded empty group', () => {
            renderDesktopApp();
            sendCommand('desktopWorkdirState', { workdir: '/work/a', recentWorkdirs: ['/work/a'] });
            sendCommand('desktopSessionTree', { groups: [{ workdir: '/work/a', sessions: [] }] });

            expect(screen.getByTestId('desktop-session-group-/work/a')).toHaveTextContent('无会话');
        });
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
