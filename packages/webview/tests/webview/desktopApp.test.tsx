import { describe, it, expect, vi } from 'vitest';
import { render, act, fireEvent, screen } from '@testing-library/react';
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

    it('should show the workdir selector when no workdir is set', () => {
        renderDesktopApp();

        sendCommand('desktopWorkdirState', { recentWorkdirs: [] });

        expect(screen.getByTestId('workdir-selector')).toBeInTheDocument();
        expect(screen.queryByTestId('chat-container')).not.toBeInTheDocument();
    });

    it('should post desktopSelectWorkdir when clicking 选择工作目录', () => {
        const { vscode } = renderDesktopApp();
        sendCommand('desktopWorkdirState', { recentWorkdirs: [] });
        vscode.postMessage.mockClear();

        fireEvent.click(screen.getByTestId('workdir-selector-open'));

        expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'desktopSelectWorkdir' });
    });

    it('should render recent workdirs and post select/remove commands', () => {
        const { vscode } = renderDesktopApp();
        sendCommand('desktopWorkdirState', { recentWorkdirs: ['/home/user/project-a', '/home/user/project-b'] });
        vscode.postMessage.mockClear();

        const items = screen.getAllByTestId('workdir-selector-recent-item');
        expect(items).toHaveLength(2);

        fireEvent.click(items[0]);
        expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'desktopSelectRecentWorkdir', path: '/home/user/project-a' });

        const removeBtn = items[1].querySelector('.workdir-selector-recent-remove') as HTMLElement;
        fireEvent.click(removeBtn);
        expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'desktopRemoveRecentWorkdir', path: '/home/user/project-b' });
        // Remove click must not trigger selection
        expect(vscode.postMessage).not.toHaveBeenCalledWith({ command: 'desktopSelectRecentWorkdir', path: '/home/user/project-b' });
    });

    it('should post desktopUseTempWorkdir when clicking 使用临时目录', () => {
        const { vscode } = renderDesktopApp();
        sendCommand('desktopWorkdirState', { recentWorkdirs: [] });
        vscode.postMessage.mockClear();

        fireEvent.click(screen.getByText('使用临时目录'));

        expect(vscode.postMessage).toHaveBeenCalledWith({ command: 'desktopUseTempWorkdir' });
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

    it('should show the workdir selector overlay when switching workdir, and hide it on cancel', () => {
        const { vscode } = renderDesktopApp();
        sendCommand('desktopWorkdirState', { workdir: '/home/user/project', recentWorkdirs: [] });

        fireEvent.click(screen.getByTestId('desktop-workdir'));
        expect(screen.getByTestId('workdir-selector')).toBeInTheDocument();
        // Chat stays mounted underneath the overlay
        expect(screen.getByTestId('chat-container')).toBeInTheDocument();

        fireEvent.click(screen.getByText('取消'));
        expect(screen.queryByTestId('workdir-selector')).not.toBeInTheDocument();
        expect(vscode.postMessage).not.toHaveBeenCalledWith({ command: 'desktopSelectWorkdir' });
    });

    it('should hide the selector overlay when a new workdir state arrives', () => {
        renderDesktopApp();
        sendCommand('desktopWorkdirState', { workdir: '/home/user/project', recentWorkdirs: [] });

        fireEvent.click(screen.getByTestId('desktop-workdir'));
        expect(screen.getByTestId('workdir-selector')).toBeInTheDocument();

        sendCommand('desktopWorkdirState', { workdir: '/home/user/other', recentWorkdirs: ['/home/user/other'] });
        expect(screen.queryByTestId('workdir-selector')).not.toBeInTheDocument();
        expect(screen.getByTestId('chat-container')).toBeInTheDocument();
    });
});
