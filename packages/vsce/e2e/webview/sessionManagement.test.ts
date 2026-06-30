import { test, expect } from '../utils/webviewTestHarness.js';
import { MessageInjector } from '../utils/messageInjector.js';
import { UIStateVerifier } from '../utils/uiStateVerifier.js';
import { MockDataGenerator } from '../fixtures/mockData.js';

test.describe('Session Management', () => {
    test('should load and display sessions', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);
        const ui = new UIStateVerifier(webviewPage);

        // Create mock sessions
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

        // Update sessions list
        await injector.updateSessions(sessions);

        // Verify sessions are displayed in dropdown
        await expect(ui.sessionSelector).toBeEnabled();
        await ui.verifySessionOption('session-1', true);
        await ui.verifySessionOption('session-2', true);
    });

    test('should select session and update current session', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);
        const ui = new UIStateVerifier(webviewPage);

        // Setup sessions
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

        await injector.updateSessions(sessions);
        await injector.updateCurrentSession(sessions[0]);

        // Verify first session is selected
        await ui.verifySessionSelectorValue('session-1');

        // Clear message log to track new messages
        await injector.clearMessageLog();

        // Select second session
        await ui.selectSession('session-2');

        // Verify restore session command was sent
        const sentMessages = await injector.getMessagesSentToExtension();
        const restoreMessage = sentMessages.find(msg => msg.command === 'restoreSession');
        expect(restoreMessage).toBeDefined();
        expect(restoreMessage.sessionId).toBe('session-2');

        // Simulate session restore response
        await injector.updateCurrentSession(sessions[1]);
        
        // Verify second session is now selected
        await ui.verifySessionSelectorValue('session-2');
    });

    test('should create new session after clear chat through callbacks', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);
        const ui = new UIStateVerifier(webviewPage);

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

        await injector.updateSessions(originalSessions);
        await injector.updateCurrentSession(originalSessions[0]);

        // Add some messages to the session
        const conversation = [
            MockDataGenerator.createUserMessage('Hello in session'),
            MockDataGenerator.createAssistantMessage('Hi! This is in the original session.')
        ];
        await injector.updateMessages(conversation);

        // Verify session is selected and messages are present
        await ui.verifySessionSelectorValue('session-original');
        await ui.verifyMessageCount(3); // Welcome + 2 conversation messages

        // Clear message log to track clear chat command
        await injector.clearMessageLog();

        // Clear chat
        await ui.clickClearChat();

        // Verify clear command was sent
        const sentMessages = await injector.getMessagesSentToExtension();
        const clearMessage = sentMessages.find(msg => msg.command === 'clearChat');
        expect(clearMessage).toBeDefined();

        // Simulate EXPECTED BEHAVIOR through proper callback mechanism:
        // 1. Messages are cleared (agent.clearMessages() triggers onMessagesChange)
        await injector.clearMessages();
        
        // 2. Session ID changes (agent.clearMessages() also triggers onSessionIdChange)
        // This should happen automatically through the callback, but in tests we simulate it:
        const newSession = {
            id: 'session-new', 
            sessionType: 'main',
            workdir: '/test/project',
            lastActiveAt: new Date('2023-12-01T10:30:00Z'),
            latestTotalTokens: 0
        };
        
        // 3. The callback triggers updateCurrentSession 
        await injector.updateCurrentSession(newSession);
        
        // 4. The callback also triggers listSessions to refresh the list
        const updatedSessions = [...originalSessions, newSession];
        await injector.updateSessions(updatedSessions);

        // VERIFY EXPECTED BEHAVIOR:
        // - Chat should be cleared (messages gone)
        await ui.verifyChatCleared();
        
        // - Session selector should show the NEW session, not the original one
        await ui.verifySessionSelectorValue('session-new');
        
        // - Both sessions should be available in the dropdown
        await ui.verifySessionOption('session-original', true);
        await ui.verifySessionOption('session-new', true);
        
        // - The new session should be selected
        const currentSessionOptions = await ui.getSessionOptions();
        expect(currentSessionOptions).toContain('session-original');
        expect(currentSessionOptions).toContain('session-new');
    });

    test('should handle session selector during streaming', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);
        const ui = new UIStateVerifier(webviewPage);

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

        await injector.updateSessions(sessions);
        await injector.updateCurrentSession(sessions[0]);

        // Start streaming
        await injector.startStreaming();
        
        // Session selector should be disabled during streaming
        await ui.verifySessionSelectorDisabled(true);

        // End streaming
        await injector.endStreaming();
        
        // Session selector should be enabled again
        await ui.verifySessionSelectorDisabled(false);
    });

    test('should render temporary option for currentSession not in sessions list', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);
        const ui = new UIStateVerifier(webviewPage);

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

        await injector.updateSessions(sessions);
        await injector.updateCurrentSession(currentSession);

        // Verify that currentSession is selected even though it's not in sessions list
        await ui.verifySessionSelectorValue('session-not-in-list');
        
        // Verify both the temporary option and the regular session exist
        await ui.verifySessionOption('session-not-in-list', true); // Temporary option
        await ui.verifySessionOption('session-in-list', true);     // Regular option
        
        // Verify the temporary option has "新会话" in its text
        const tempOption = ui.sessionSelector.locator('option[value="session-not-in-list"]');
        await expect(tempOption).toContainText('新会话');
        
        // Should have 2 options total (excluding the disabled placeholder)
        const allOptions = await ui.getSessionOptions();
        expect(allOptions).toHaveLength(2);
        expect(allOptions).toContain('session-not-in-list');
        expect(allOptions).toContain('session-in-list');
    });
});