import { describe, it, expect } from 'vitest';
import { renderChatApp, screen, fireEvent, act, sendCommand } from './test-utils';

/**
 * Open the more menu by clicking the more button in the header.
 */
function openMoreMenu() {
    const moreBtn = screen.getByTestId('more-btn');
    act(() => {
        fireEvent.click(moreBtn);
    });
    return screen.getByTestId('more-menu');
}

describe('More Menu', () => {
    it('should render the three menu items when opened', () => {
        renderChatApp();

        openMoreMenu();

        expect(screen.getByTestId('more-menu-settings')).toHaveTextContent('设置');
        expect(screen.getByTestId('more-menu-enterprise')).toHaveTextContent('企业控制台');
        expect(screen.getByTestId('more-menu-logout')).toHaveTextContent('退出登录');
    });

    it('should open settings dialog and request configuration when 设置 is clicked', () => {
        const { vscode } = renderChatApp();

        vscode.postMessage.mockClear();
        openMoreMenu();

        act(() => {
            fireEvent.click(screen.getByTestId('more-menu-settings'));
        });

        // Config dialog should open and configuration should be requested
        expect(vscode.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({ command: 'getConfiguration' })
        );
        // Menu closes after selection
        expect(screen.queryByTestId('more-menu')).not.toBeInTheDocument();
    });

    it('should post openExternal with the serverUrl when 企业控制台 is clicked', () => {
        const { vscode } = renderChatApp();

        act(() => {
            sendCommand('configurationResponse', {
                configurationData: { serverUrl: 'https://console.example.com' }
            });
        });

        vscode.postMessage.mockClear();
        openMoreMenu();

        act(() => {
            fireEvent.click(screen.getByTestId('more-menu-enterprise'));
        });

        expect(vscode.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                command: 'openExternal',
                url: 'https://console.example.com'
            })
        );
        expect(screen.queryByTestId('more-menu')).not.toBeInTheDocument();
    });

    it('should not post openExternal when serverUrl is missing', () => {
        const { vscode } = renderChatApp();

        vscode.postMessage.mockClear();
        openMoreMenu();

        act(() => {
            fireEvent.click(screen.getByTestId('more-menu-enterprise'));
        });

        expect(vscode.postMessage).not.toHaveBeenCalledWith(
            expect.objectContaining({ command: 'openExternal' })
        );
    });

    it('should post logout when 退出登录 is clicked', () => {
        const { vscode } = renderChatApp();

        vscode.postMessage.mockClear();
        openMoreMenu();

        act(() => {
            fireEvent.click(screen.getByTestId('more-menu-logout'));
        });

        expect(vscode.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({ command: 'logout' })
        );
        expect(screen.queryByTestId('more-menu')).not.toBeInTheDocument();
    });

    it('should close the menu when Escape is pressed', () => {
        renderChatApp();

        openMoreMenu();
        expect(screen.getByTestId('more-menu')).toBeInTheDocument();

        act(() => {
            fireEvent.keyDown(document, { key: 'Escape' });
        });

        expect(screen.queryByTestId('more-menu')).not.toBeInTheDocument();
    });
});
