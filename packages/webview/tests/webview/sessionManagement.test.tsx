import { describe, it, expect } from 'vitest';
import { renderChatApp, screen, fireEvent, act, sendCommand } from './test-utils';
import { MockDataGenerator } from '../fixtures/mockData';

/**
 * Open the session history popup by clicking the history button in the header.
 */
function openSessionListPopup() {
    const historyBtn = screen.getByTestId('history-btn');
    act(() => {
        fireEvent.click(historyBtn);
    });
    return screen.getByTestId('session-list-popup');
}

describe('Session Management', () => {
    it('should load and display sessions in the history popup', () => {
        renderChatApp();

        const sessions = [
            {
                id: 'session-1',
                sessionType: 'main',
                workdir: '/test/project',
                firstMessage: 'First session hello',
                lastActiveAt: new Date('2023-12-01T10:00:00Z'),
                latestTotalTokens: 150
            },
            {
                id: 'session-2',
                sessionType: 'main',
                workdir: '/test/project',
                firstMessage: 'Second session world',
                lastActiveAt: new Date('2023-12-01T11:00:00Z'),
                latestTotalTokens: 250
            }
        ];

        act(() => {
            sendCommand('updateSessions', { sessions });
        });

        openSessionListPopup();

        expect(screen.getByTestId('session-list-item-session-1')).toBeInTheDocument();
        expect(screen.getByTestId('session-list-item-session-2')).toBeInTheDocument();
        expect(screen.getByTestId('session-list-item-session-1')).toHaveTextContent('First session hello');
        expect(screen.getByTestId('session-list-item-session-2')).toHaveTextContent('Second session world');
    });

    it('should select session and update current session', () => {
        const { vscode } = renderChatApp();

        const sessions = [
            {
                id: 'session-1',
                sessionType: 'main',
                workdir: '/test/project',
                firstMessage: 'First session hello',
                lastActiveAt: new Date('2023-12-01T10:00:00Z'),
                latestTotalTokens: 150
            },
            {
                id: 'session-2',
                sessionType: 'main',
                workdir: '/test/project',
                firstMessage: 'Second session world',
                lastActiveAt: new Date('2023-12-01T11:00:00Z'),
                latestTotalTokens: 250
            }
        ];

        act(() => {
            sendCommand('updateSessions', { sessions });
            sendCommand('updateCurrentSession', { session: sessions[0] });
        });

        // Title reflects the current session
        expect(screen.getByTestId('chat-header')).toHaveTextContent('First session hello');

        // Clear message log to track new messages
        vscode.postMessage.mockClear();

        // Open popup and select second session
        openSessionListPopup();
        act(() => {
            fireEvent.click(screen.getByTestId('session-list-item-session-2'));
        });

        // Verify restore session command was sent
        expect(vscode.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                command: 'restoreSession',
                sessionId: 'session-2'
            })
        );

        // Popup closes after selection
        expect(screen.queryByTestId('session-list-popup')).not.toBeInTheDocument();

        // Simulate session restore response
        act(() => {
            sendCommand('updateCurrentSession', { session: sessions[1] });
        });

        // Verify title now reflects second session
        expect(screen.getByTestId('chat-header')).toHaveTextContent('Second session world');
    });

    it('should filter sessions and highlight matches in the search box', () => {
        renderChatApp();

        const sessions = [
            {
                id: 'session-1',
                sessionType: 'main',
                workdir: '/test/project',
                firstMessage: 'Alpha task about auth',
                lastActiveAt: new Date('2023-12-01T10:00:00Z'),
                latestTotalTokens: 150
            },
            {
                id: 'session-2',
                sessionType: 'main',
                workdir: '/test/project',
                firstMessage: 'Beta task about billing',
                lastActiveAt: new Date('2023-12-01T11:00:00Z'),
                latestTotalTokens: 250
            }
        ];

        act(() => {
            sendCommand('updateSessions', { sessions });
        });

        const popup = openSessionListPopup();
        const searchInput = popup.querySelector('.session-list-search') as HTMLInputElement;
        expect(searchInput).not.toBeNull();

        // Type a query that matches only the first session
        act(() => {
            fireEvent.change(searchInput, { target: { value: 'alpha' } });
        });

        // Only session-1 should remain
        expect(screen.getByTestId('session-list-item-session-1')).toBeInTheDocument();
        expect(screen.queryByTestId('session-list-item-session-2')).not.toBeInTheDocument();

        // Matched fragment should carry the highlight class
        const highlight = popup.querySelector('.session-list-highlight');
        expect(highlight).not.toBeNull();
        expect(highlight).toHaveTextContent(/alpha/i);
    });

    it('should show empty state when no session matches the query', () => {
        renderChatApp();

        const sessions = [
            {
                id: 'session-1',
                sessionType: 'main',
                workdir: '/test/project',
                firstMessage: 'Alpha task',
                lastActiveAt: new Date('2023-12-01T10:00:00Z'),
                latestTotalTokens: 150
            }
        ];

        act(() => {
            sendCommand('updateSessions', { sessions });
        });

        const popup = openSessionListPopup();
        const searchInput = popup.querySelector('.session-list-search') as HTMLInputElement;

        act(() => {
            fireEvent.change(searchInput, { target: { value: 'nonexistent-keyword' } });
        });

        expect(popup).toHaveTextContent('未找到匹配的历史记录');
    });

    it('should create new session after clear chat through callbacks', () => {
        const { vscode } = renderChatApp();

        // Setup: Create and select a session with some messages
        const originalSessions = [
            {
                id: 'session-original',
                sessionType: 'main',
                workdir: '/test/project',
                firstMessage: 'Original session',
                lastActiveAt: new Date('2023-12-01T10:00:00Z'),
                latestTotalTokens: 150
            }
        ];

        act(() => {
            sendCommand('updateSessions', { sessions: originalSessions });
            sendCommand('updateCurrentSession', { session: originalSessions[0] });
        });

        // Add some messages to the session
        const conversation = [
            MockDataGenerator.createUserMessage('Hello in session'),
            MockDataGenerator.createAssistantMessage('Hi! This is in the original session.')
        ];
        act(() => {
            sendCommand('updateMessages', { messages: conversation });
        });

        // Verify current session title and messages are present
        expect(screen.getByTestId('chat-header')).toHaveTextContent('Original session');

        const messages = document.querySelectorAll('.messages-container .message');
        expect(messages.length).toBe(2); // 2 conversation messages

        // Clear message log to track clear chat command
        vscode.postMessage.mockClear();

        // Clear chat (new session)
        const clearBtn = screen.getByTestId('clear-chat-btn');
        act(() => {
            fireEvent.click(clearBtn);
        });

        // Verify clear command was sent
        expect(vscode.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({ command: 'clearChat' })
        );

        // Simulate EXPECTED BEHAVIOR through proper callback mechanism:
        // 1. Messages are cleared
        act(() => {
            sendCommand('updateMessages', { messages: [] });
        });

        // 2. Session ID changes
        const newSession = {
            id: 'session-new',
            sessionType: 'main',
            workdir: '/test/project',
            firstMessage: 'Brand new session',
            lastActiveAt: new Date('2023-12-01T10:30:00Z'),
            latestTotalTokens: 0
        };

        // 3. The callback triggers updateCurrentSession
        act(() => {
            sendCommand('updateCurrentSession', { session: newSession });
        });

        // 4. The callback also triggers listSessions to refresh the list
        const updatedSessions = [...originalSessions, newSession];
        act(() => {
            sendCommand('updateSessions', { sessions: updatedSessions });
        });

        // VERIFY EXPECTED BEHAVIOR:
        // - Chat should be cleared (welcome view shown, no messages container)
        expect(screen.getByText('Hi~ 欢迎使用 Wave 代码智聊')).toBeInTheDocument();

        // - Header title should show the NEW session, not the original
        expect(screen.getByTestId('chat-header')).toHaveTextContent('Brand new session');

        // - Both sessions should be available in the history popup
        openSessionListPopup();
        expect(screen.getByTestId('session-list-item-session-original')).toBeInTheDocument();
        expect(screen.getByTestId('session-list-item-session-new')).toBeInTheDocument();
    });

    it('should disable the new session button during streaming', () => {
        renderChatApp();

        // Setup sessions
        const sessions = [
            {
                id: 'session-1',
                sessionType: 'main',
                workdir: '/test/project',
                firstMessage: 'A session',
                lastActiveAt: new Date('2023-12-01T10:00:00Z'),
                latestTotalTokens: 150
            }
        ];

        act(() => {
            sendCommand('updateSessions', { sessions });
            sendCommand('updateCurrentSession', { session: sessions[0] });
        });

        // Start streaming
        act(() => {
            sendCommand('startStreaming');
        });

        // New session button should be disabled during streaming
        expect(screen.getByTestId('clear-chat-btn')).toBeDisabled();

        // End streaming
        act(() => {
            sendCommand('endStreaming');
        });

        // Button should be enabled again
        expect(screen.getByTestId('clear-chat-btn')).not.toBeDisabled();
    });

    it('should show 新会话 title when current session is not yet in the list', () => {
        renderChatApp();

        // sessions list with one session
        const sessions = [
            {
                id: 'session-in-list',
                sessionType: 'main',
                workdir: '/test/project',
                firstMessage: 'Existing session',
                lastActiveAt: new Date('2023-12-01T10:00:00Z'),
                latestTotalTokens: 150
            }
        ];

        // currentSession has no firstMessage -> label falls back to date/time,
        // but with no currentSession set the title shows the default 新会话
        act(() => {
            sendCommand('updateSessions', { sessions });
        });

        // Without a current session the header shows the default title
        expect(screen.getByTestId('chat-header')).toHaveTextContent('新会话');

        // The existing session is still listed in the popup
        openSessionListPopup();
        expect(screen.getByTestId('session-list-item-session-in-list')).toBeInTheDocument();
    });
});
