import { describe, it, expect } from 'vitest';
import { render, screen, act, sendCommand, createMockVscode } from './test-utils';
import { ChatApp } from '../../src/components/ChatApp';

/**
 * Reproduces the welcome-page login-button flash:
 * Before the backend pushes `setInitialState` (which carries the real auth
 * status), the webview's initial `isAuthenticated` is `false`. A logged-in user
 * would briefly see the "登 录" CTA, which then disappears once the real status
 * arrives — a visible flash. The welcome page (incl. login button) must not
 * render until the initial state is available.
 */
describe('WelcomeView login button flash', () => {
    it('does not show the login button before initial state arrives', () => {
        // Render directly (bypassing renderChatApp's auto authStatusResponse) to
        // simulate the very first frame before setInitialState reaches the webview.
        render(<ChatApp vscode={createMockVscode()} />);

        expect(screen.queryByText('登 录')).not.toBeInTheDocument();
        expect(screen.queryByText('登录后即可开始使用~')).not.toBeInTheDocument();
    });

    it('shows the login button once initial state arrives with isAuthenticated:false', () => {
        render(<ChatApp vscode={createMockVscode()} />);

        act(() => {
            sendCommand('setInitialState', {
                messages: [],
                isStreaming: false,
                sessions: [],
                isAuthenticated: false,
                configurationData: {},
                pendingConfirmations: []
            });
        });

        expect(screen.getByText('登 录')).toBeVisible();
    });

    it('does not show the login button when initial state arrives with isAuthenticated:true', () => {
        render(<ChatApp vscode={createMockVscode()} />);

        act(() => {
            sendCommand('setInitialState', {
                messages: [],
                isStreaming: false,
                sessions: [],
                isAuthenticated: true,
                configurationData: {},
                pendingConfirmations: []
            });
        });

        expect(screen.queryByText('登 录')).not.toBeInTheDocument();
    });
});
