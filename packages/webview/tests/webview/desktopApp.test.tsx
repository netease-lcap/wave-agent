import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import React from 'react';
import { DesktopApp } from '../../src/components/DesktopApp';
import { createMockVscode, sendCommand, fireInput } from './test-utils';
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
        // The header more button moves to the sidebar on desktop
        expect(screen.queryByTestId('more-btn')).not.toBeInTheDocument();
        expect(screen.getByTestId('desktop-more-btn')).toBeInTheDocument();
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

    describe('sidebar more menu (FR-037)', () => {
        function openSidebarMoreMenu() {
            fireEvent.click(screen.getByTestId('desktop-more-btn'));
            return screen.getByTestId('more-menu');
        }

        it('renders the more button in the sidebar header, not the chat header', () => {
            renderDesktopApp();
            sendCommand('desktopWorkdirState', { workdir: '/work/a', recentWorkdirs: [] });

            const sidebar = screen.getByTestId('desktop-sidebar');
            expect(sidebar.querySelector('[data-testid="desktop-more-btn"]')).not.toBeNull();
            expect(screen.getByTestId('chat-header').querySelector('[data-testid="more-btn"]')).toBeNull();
        });

        it('opens the shared menu with all items and closes on Escape', () => {
            renderDesktopApp();
            sendCommand('desktopWorkdirState', { workdir: '/work/a', recentWorkdirs: [] });
            sendCommand('authStatusResponse', { isAuthenticated: true });

            openSidebarMoreMenu();

            expect(screen.getByTestId('more-menu-settings')).toHaveTextContent('设置');
            expect(screen.getByTestId('more-menu-enterprise')).toHaveTextContent('企业控制台');
            expect(screen.getByTestId('more-menu-logout')).toHaveTextContent('退出登录');

            fireEvent.keyDown(document, { key: 'Escape' });
            expect(screen.queryByTestId('more-menu')).not.toBeInTheDocument();
        });

        it('stays available when no workdir is selected', () => {
            renderDesktopApp();
            sendCommand('desktopWorkdirState', { recentWorkdirs: [] });

            openSidebarMoreMenu();

            expect(screen.getByTestId('more-menu-settings')).toBeInTheDocument();
        });

        it('requests configuration when 设置 is clicked', () => {
            const { vscode } = renderDesktopApp();
            sendCommand('desktopWorkdirState', { workdir: '/work/a', recentWorkdirs: [] });
            vscode.postMessage.mockClear();

            openSidebarMoreMenu();
            fireEvent.click(screen.getByTestId('more-menu-settings'));

            expect(vscode.postMessage).toHaveBeenCalledWith(
                expect.objectContaining({ command: 'getConfiguration' })
            );
            expect(screen.queryByTestId('more-menu')).not.toBeInTheDocument();
        });

        it('posts login when 登录 is clicked while unauthenticated', () => {
            const { vscode } = renderDesktopApp();
            sendCommand('desktopWorkdirState', { workdir: '/work/a', recentWorkdirs: [] });
            sendCommand('authStatusResponse', { isAuthenticated: false });
            vscode.postMessage.mockClear();

            openSidebarMoreMenu();
            expect(screen.queryByTestId('more-menu-logout')).not.toBeInTheDocument();
            fireEvent.click(screen.getByTestId('more-menu-login'));

            expect(vscode.postMessage).toHaveBeenCalledWith(
                expect.objectContaining({ command: 'login' })
            );
        });
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

        it('expands the group containing the current session even when its workdir differs (worktree session)', () => {
            renderDesktopApp();
            // Worktree session active: current workdir is the worktree path,
            // but the session groups under its repo root (FR-020/FR-023).
            sendCommand('desktopWorkdirState', { workdir: '/work/a/.wave/worktrees/gentle-pike-147', recentWorkdirs: ['/work/a'] });
            sendCommand('desktopSessionTree', {
                groups: [{ workdir: '/work/a', sessions: [session('s1', 'worktree chat')] }],
            });
            sendCommand('updateCurrentSession', { session: { id: 's1', sessionType: 'main', workdir: '/work/a/.wave/worktrees/gentle-pike-147', createdAt: '2026-07-20T00:00:00.000Z', lastActiveAt: '2026-07-21T00:00:00.000Z', latestTotalTokens: 0, firstMessage: 'worktree chat' } });

            expect(screen.getByTestId('desktop-session-item-s1')).toBeInTheDocument();
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

        it('posts desktopDeleteSession after the user confirms', () => {
            const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
            const { vscode } = renderDesktopApp();
            sendCommand('desktopWorkdirState', { workdir: '/work/a', recentWorkdirs: ['/work/a'] });
            sendCommand('desktopSessionTree', {
                groups: [{ workdir: '/work/a', sessions: [session('s1', 'hello a')] }],
            });
            vscode.postMessage.mockClear();

            fireEvent.click(screen.getByTestId('desktop-session-delete-s1'));

            expect(vscode.postMessage).toHaveBeenCalledWith({
                command: 'desktopDeleteSession',
                sessionId: 's1',
            });
            confirmSpy.mockRestore();
        });

        it('does not delete when the user cancels the confirm dialog', () => {
            const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
            const { vscode } = renderDesktopApp();
            sendCommand('desktopWorkdirState', { workdir: '/work/a', recentWorkdirs: ['/work/a'] });
            sendCommand('desktopSessionTree', {
                groups: [{ workdir: '/work/a', sessions: [session('s1', 'hello a')] }],
            });
            vscode.postMessage.mockClear();

            fireEvent.click(screen.getByTestId('desktop-session-delete-s1'));

            expect(vscode.postMessage).not.toHaveBeenCalled();
            confirmSpy.mockRestore();
        });

        it('warns about worktree + temp branch cleanup when deleting a worktree session', () => {
            const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
            renderDesktopApp();
            sendCommand('desktopWorkdirState', { workdir: '/work/a', recentWorkdirs: ['/work/a'] });
            sendCommand('desktopSessionTree', {
                groups: [
                    {
                        workdir: '/work/a',
                        sessions: [
                            { sessionId: 'wt', title: 'wt session', lastActiveAt: Date.now(), hasWorktree: true },
                        ],
                    },
                ],
            });

            fireEvent.click(screen.getByTestId('desktop-session-delete-wt'));

            expect(confirmSpy).toHaveBeenCalledWith(
                expect.stringContaining('worktree 目录与临时分支将一并删除'),
            );
            confirmSpy.mockRestore();
        });
    });

    describe('worktree controls (FR-022/FR-023)', () => {
        const branches = { branches: ['main', 'dev'], current: 'main' };

        it('requests branches when a workdir arrives and shows branch selector + checkbox', () => {
            const { vscode } = renderDesktopApp();
            sendCommand('desktopWorkdirState', { workdir: '/work/a', recentWorkdirs: ['/work/a'] });

            expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'desktopListGitBranches', workdir: '/work/a' });
            // Controls hidden until the branch list arrives
            expect(screen.queryByTestId('desktop-worktree-controls')).not.toBeInTheDocument();

            sendCommand('desktopGitBranches', { workdir: '/work/a', result: branches });

            expect(screen.getByTestId('desktop-branch-selector')).toHaveTextContent('main');
            const checkbox = screen.getByTestId('desktop-worktree-checkbox').querySelector('input');
            expect(checkbox).toBeChecked();
        });

        it('stays hidden when the workdir is not a git repo (result null)', () => {
            renderDesktopApp();
            sendCommand('desktopWorkdirState', { workdir: '/work/a', recentWorkdirs: ['/work/a'] });
            sendCommand('desktopGitBranches', { workdir: '/work/a', result: null });

            expect(screen.queryByTestId('desktop-worktree-controls')).not.toBeInTheDocument();
        });

        it('hides stale controls immediately on workdir change until fresh branches arrive', () => {
            renderDesktopApp();
            sendCommand('desktopWorkdirState', { workdir: '/work/a', recentWorkdirs: ['/work/a'] });
            sendCommand('desktopGitBranches', { workdir: '/work/a', result: branches });
            expect(screen.getByTestId('desktop-worktree-controls')).toBeInTheDocument();

            sendCommand('desktopWorkdirState', { workdir: '/work/b', recentWorkdirs: ['/work/a', '/work/b'] });

            expect(screen.queryByTestId('desktop-worktree-controls')).not.toBeInTheDocument();
        });

        it('selects a branch from the dropdown', () => {
            renderDesktopApp();
            sendCommand('desktopWorkdirState', { workdir: '/work/a', recentWorkdirs: ['/work/a'] });
            sendCommand('desktopGitBranches', { workdir: '/work/a', result: branches });

            fireEvent.click(screen.getByTestId('desktop-branch-selector'));
            const items = screen.getAllByTestId('desktop-branch-item');
            expect(items).toHaveLength(2);

            fireEvent.click(items[1]);
            expect(screen.getByTestId('desktop-branch-selector')).toHaveTextContent('dev');
            expect(screen.queryByTestId('desktop-branch-menu')).not.toBeInTheDocument();
        });

        it('posts desktopCreateWorktree instead of sendMessage when the checkbox is on', async () => {
            const { vscode } = renderDesktopApp();
            sendCommand('desktopWorkdirState', { workdir: '/work/a', recentWorkdirs: ['/work/a'] });
            sendCommand('desktopGitBranches', { workdir: '/work/a', result: branches });
            vscode.postMessage.mockClear();

            // Pick dev as the base branch (the checkbox is on by default)
            fireEvent.click(screen.getByTestId('desktop-branch-selector'));
            fireEvent.click(screen.getAllByTestId('desktop-branch-item')[1]);

            const input = screen.getByTestId('message-input');
            input.textContent = 'hello worktree';
            await fireInput(input, { inputType: 'insertText' });
            fireEvent.click(screen.getByTestId('send-btn'));

            const sentMessages = vscode.postMessage.mock.calls.map((c) => c[0]);
            expect(sentMessages.find((m: Record<string, unknown>) => m.command === 'sendMessage')).toBeUndefined();
            expect(sentMessages.find((m: Record<string, unknown>) => m.command === 'desktopCreateWorktree')).toEqual({
                command: 'desktopCreateWorktree',
                workdir: '/work/a',
                baseBranch: 'dev',
                text: 'hello worktree',
                images: undefined,
            });
            // Checkbox stays at its checked default for the next session
            expect(screen.getByTestId('desktop-worktree-checkbox').querySelector('input')).toBeChecked();
        });

        it('posts sendMessage normally when the checkbox is off', async () => {
            const { vscode } = renderDesktopApp();
            sendCommand('desktopWorkdirState', { workdir: '/work/a', recentWorkdirs: ['/work/a'] });
            sendCommand('desktopGitBranches', { workdir: '/work/a', result: branches });
            vscode.postMessage.mockClear();

            // Untick the default-checked checkbox
            fireEvent.click(screen.getByTestId('desktop-worktree-checkbox').querySelector('input')!);

            const input = screen.getByTestId('message-input');
            input.textContent = 'plain message';
            await fireInput(input, { inputType: 'insertText' });
            fireEvent.click(screen.getByTestId('send-btn'));

            const sentMessages = vscode.postMessage.mock.calls.map((c) => c[0]);
            expect(sentMessages.find((m: Record<string, unknown>) => m.command === 'desktopCreateWorktree')).toBeUndefined();
            expect(sentMessages.find((m: Record<string, unknown>) => m.command === 'sendMessage')).toBeDefined();
        });

        it('hides the controls once the conversation starts', () => {
            renderDesktopApp();
            sendCommand('desktopWorkdirState', { workdir: '/work/a', recentWorkdirs: ['/work/a'] });
            sendCommand('desktopGitBranches', { workdir: '/work/a', result: branches });
            expect(screen.getByTestId('desktop-worktree-controls')).toBeInTheDocument();

            sendCommand('updateMessages', { messages: [MockDataGenerator.createUserMessage('hi')] });

            expect(screen.queryByTestId('desktop-worktree-controls')).not.toBeInTheDocument();
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
