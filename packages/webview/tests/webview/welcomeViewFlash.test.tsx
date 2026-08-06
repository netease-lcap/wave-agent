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

    /**
     * Regression: a SessionStart hook can inject hidden context as an isMeta
     * user message (e.g. this repo's "SessionStart hook additional context"
     * reminder). Hidden messages are not chat content: they must not suppress
     * the welcome page, or the user sees a blank area (MessageList filters
     * them out of rendering, but state.messages.length used to count them).
     */
    it('keeps showing the welcome page when only hidden meta messages exist', () => {
        render(<ChatApp vscode={createMockVscode()} />);

        act(() => {
            sendCommand('setInitialState', {
                messages: [
                    {
                        id: 'meta-1',
                        role: 'user',
                        isMeta: true,
                        timestamp: new Date().toISOString(),
                        blocks: [
                            {
                                type: 'text',
                                content:
                                    '<system-reminder>\nSessionStart hook additional context: …\n</system-reminder>'
                            }
                        ]
                    }
                ],
                isStreaming: false,
                sessions: [],
                isAuthenticated: false,
                configurationData: {},
                pendingConfirmations: []
            });
        });

        // Welcome page still shown (not a blank message area).
        expect(screen.getByText('登 录')).toBeVisible();
    });

    it('switches away from the welcome page once a visible message arrives', () => {
        render(<ChatApp vscode={createMockVscode()} />);

        act(() => {
            sendCommand('setInitialState', {
                messages: [
                    {
                        id: 'meta-1',
                        role: 'user',
                        isMeta: true,
                        timestamp: new Date().toISOString(),
                        blocks: [{ type: 'text', content: '<system-reminder>hidden context</system-reminder>' }]
                    },
                    {
                        id: 'user-1',
                        role: 'user',
                        timestamp: new Date().toISOString(),
                        blocks: [{ type: 'text', content: 'hello' }]
                    }
                ],
                isStreaming: false,
                sessions: [],
                isAuthenticated: false,
                configurationData: {},
                pendingConfirmations: []
            });
        });

        expect(screen.queryByText('登 录')).not.toBeInTheDocument();
    });
});
