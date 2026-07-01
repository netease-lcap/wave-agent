import { describe, it, expect } from 'vitest';
import { renderChatApp, screen, fireEvent, act, sendCommand } from './test-utils';
import { MockDataGenerator } from '../fixtures/mockData';

describe('Session Management', () => {
    it('should load and display sessions', () => {
        renderChatApp();

        const sessions = [
            {
                id: 'session-1',
                sessionType: 'main',
                workdir: '/test/project',
                lastActiveAt: new Date('2023-12-01T10:00:00Z'),
                latestTotalTokens: 150
            },
            {
                id: 'session-2',
                sessionType: 'main',
                workdir: '/test/project',
                lastActiveAt: new Date('2023-12-01T11:00:00Z'),
                latestTotalTokens: 250
            }
        ];

        act(() => {
            sendCommand('updateSessions', { sessions });
        });

        // Verify sessions are displayed in dropdown
        const dropdown = screen.getByTestId('session-dropdown') as HTMLSelectElement;
        expect(dropdown).not.toBeDisabled();

        const option1 = dropdown.querySelector('option[value="session-1"]');
        expect(option1).not.toBeNull();

        const option2 = dropdown.querySelector('option[value="session-2"]');
        expect(option2).not.toBeNull();
    });

    it('should select session and update current session', () => {
        const { vscode } = renderChatApp();

        const sessions = [
            {
                id: 'session-1',
                sessionType: 'main',
                workdir: '/test/project',
                lastActiveAt: new Date('2023-12-01T10:00:00Z'),
                latestTotalTokens: 150
            },
            {
                id: 'session-2',
                sessionType: 'main',
                workdir: '/test/project',
                lastActiveAt: new Date('2023-12-01T11:00:00Z'),
                latestTotalTokens: 250
            }
        ];

        act(() => {
            sendCommand('updateSessions', { sessions });
            sendCommand('updateCurrentSession', { session: sessions[0] });
        });

        // Verify first session is selected
        const dropdown = screen.getByTestId('session-dropdown') as HTMLSelectElement;
        expect(dropdown.value).toBe('session-1');

        // Clear message log to track new messages
        vscode.postMessage.mockClear();

        // Select second session
        act(() => {
            fireEvent.change(dropdown, { target: { value: 'session-2' } });
        });

        // Verify restore session command was sent
        expect(vscode.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                command: 'restoreSession',
                sessionId: 'session-2'
            })
        );

        // Simulate session restore response
        act(() => {
            sendCommand('updateCurrentSession', { session: sessions[1] });
        });

        // Verify second session is now selected
        expect(dropdown.value).toBe('session-2');
    });

    it('should create new session after clear chat through callbacks', () => {
        const { vscode } = renderChatApp();

        // Setup: Create and select a session with some messages
        const originalSessions = [
            {
                id: 'session-original',
                sessionType: 'main',
                workdir: '/test/project',
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

        // Verify session is selected and messages are present
        const dropdown = screen.getByTestId('session-dropdown') as HTMLSelectElement;
        expect(dropdown.value).toBe('session-original');

        const messages = document.querySelectorAll('.messages-container .message');
        expect(messages.length).toBe(3); // Welcome + 2 conversation messages

        // Clear message log to track clear chat command
        vscode.postMessage.mockClear();

        // Clear chat
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
        // - Chat should be cleared (messages gone)
        const messagesAfter = document.querySelectorAll('.messages-container .message');
        expect(messagesAfter.length).toBe(1); // welcome only

        // - Session selector should show the NEW session, not the original
        expect(dropdown.value).toBe('session-new');

        // - Both sessions should be available in the dropdown
        const optionOriginal = dropdown.querySelector('option[value="session-original"]');
        expect(optionOriginal).not.toBeNull();

        const optionNew = dropdown.querySelector('option[value="session-new"]');
        expect(optionNew).not.toBeNull();
    });

    it('should handle session selector during streaming', () => {
        renderChatApp();

        // Setup sessions
        const sessions = [
            {
                id: 'session-1',
                sessionType: 'main',
                workdir: '/test/project',
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

        // Session selector should be disabled during streaming
        const dropdown = screen.getByTestId('session-dropdown') as HTMLSelectElement;
        expect(dropdown).toBeDisabled();

        // End streaming
        act(() => {
            sendCommand('endStreaming');
        });

        // Session selector should be enabled again
        expect(dropdown).not.toBeDisabled();
    });

    it('should render temporary option for currentSession not in sessions list', () => {
        renderChatApp();

        // Setup: sessions list with one session
        const sessions = [
            {
                id: 'session-in-list',
                sessionType: 'main',
                workdir: '/test/project',
                lastActiveAt: new Date('2023-12-01T10:00:00Z'),
                latestTotalTokens: 150
            }
        ];

        // But currentSession is a different one not in the list
        const currentSession = {
            id: 'session-not-in-list',
            sessionType: 'main',
            workdir: '/test/project',
            lastActiveAt: new Date('2023-12-01T11:00:00Z'),
            latestTotalTokens: 250
        };

        act(() => {
            sendCommand('updateSessions', { sessions });
            sendCommand('updateCurrentSession', { session: currentSession });
        });

        // Verify that currentSession is selected even though it's not in sessions list
        const dropdown = screen.getByTestId('session-dropdown') as HTMLSelectElement;
        expect(dropdown.value).toBe('session-not-in-list');

        // Verify both the temporary option and the regular session exist
        const tempOption = dropdown.querySelector('option[value="session-not-in-list"]');
        expect(tempOption).not.toBeNull();

        const regularOption = dropdown.querySelector('option[value="session-in-list"]');
        expect(regularOption).not.toBeNull();

        // Verify the temporary option has "新会话" in its text
        expect(tempOption).toHaveTextContent('新会话');

        // Should have 2 options total (excluding the disabled placeholder)
        const allOptions = dropdown.querySelectorAll('option[value]:not([value=""])');
        expect(allOptions.length).toBe(2);
    });
});
