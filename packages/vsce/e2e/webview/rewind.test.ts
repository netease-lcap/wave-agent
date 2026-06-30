import { test, expect } from '../utils/webviewTestHarness.js';
import { MessageInjector } from '../utils/messageInjector.js';
import { UIStateVerifier } from '../utils/uiStateVerifier.js';
import { MockDataGenerator } from '../fixtures/mockData.js';

test.describe('Rewind Feature', () => {
    test('should send rewindToMessage command when clicking rewind button', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);
        const ui = new UIStateVerifier(webviewPage);

        // Setup a conversation with multiple messages
        const messages = [
            MockDataGenerator.createUserMessage('Message 1', 'msg-1'),
            MockDataGenerator.createAssistantMessage('Response 1', 'msg-2'),
            MockDataGenerator.createUserMessage('Message 2', 'msg-3'),
            MockDataGenerator.createAssistantMessage('Response 2', 'msg-4')
        ];
        await injector.updateMessages(messages);

        // Verify messages are displayed
        await ui.verifyMessageCount(5); // Welcome + 4 messages

        // Clear message log to track new commands
        await injector.clearMessageLog();

        // Click rewind on the first user message (Message 1)
        // Note: userMessages.nth(0) is 'Message 1'
        await ui.clickRewind(0);

        // Verify rewindToMessage command was sent to extension
        const sentMessages = await injector.getMessagesSentToExtension();
        const rewindCommand = sentMessages.find(m => m.command === 'rewindToMessage');
        expect(rewindCommand).toBeDefined();
        expect(rewindCommand).toEqual({
            command: 'rewindToMessage',
            messageId: 'msg-1'
        });
    });

    test('should remove selected message and put its content back to input after rewind', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);
        const ui = new UIStateVerifier(webviewPage);

        // Setup a conversation
        const messages = [
            MockDataGenerator.createUserMessage('Message 1', 'msg-1'),
            MockDataGenerator.createAssistantMessage('Response 1', 'msg-2'),
            MockDataGenerator.createUserMessage('Message 2', 'msg-3'),
            MockDataGenerator.createAssistantMessage('Response 2', 'msg-4')
        ];
        await injector.updateMessages(messages);

        // Verify messages are displayed
        await ui.verifyMessageCount(5); // Welcome + 4 messages

        // Click rewind on the second user message (Message 2)
        // Note: userMessages.nth(1) is 'Message 2'
        await ui.clickRewind(1);

        // Simulate backend response after rewind
        // In real scenario, backend would truncate history and send setInitialState
        const updatedMessages = [
            messages[0],
            messages[1]
        ];
        
        // We need to simulate the setInitialState command that handleRewindToMessage triggers
        await injector.simulateExtensionMessage('setInitialState', {
            messages: updatedMessages,
            inputContent: 'Message 2',
            tasks: [],
            isStreaming: false,
            sessions: [],
            configurationData: {
                apiKey: '',
                baseURL: '',
                model: '',
                fastModel: '',
                language: 'zh-CN',
                permissionMode: 'ask'
            }
        });

        // Verify Message 2 and Response 2 are removed
        await ui.verifyMessageCount(3); // Welcome + Message 1 + Response 1
        
        // Message 2 should only exist in the input box, not in the message list
        const messageList = webviewPage.getByTestId('messages-container');
        await expect(messageList.getByText('Message 2')).toHaveCount(0);

        // Verify input box has 'Message 2'
        await expect(ui.messageInput).toHaveText('Message 2');
    });

    test('should not show rewind button on assistant messages', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);
        const ui = new UIStateVerifier(webviewPage);

        const messages = [
            MockDataGenerator.createUserMessage('User message'),
            MockDataGenerator.createAssistantMessage('Assistant message')
        ];
        await injector.updateMessages(messages);

        // Hover over assistant message and check for rewind button
        const assistantMessage = ui.assistantMessages.first();
        await assistantMessage.hover();
        const rewindBtn = assistantMessage.locator('.message-action-btn');
        await expect(rewindBtn).toBeHidden();
    });
});
