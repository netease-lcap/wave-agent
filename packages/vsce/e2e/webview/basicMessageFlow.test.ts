import { test, expect } from '../utils/webviewTestHarness.js';
import { MessageInjector } from '../utils/messageInjector.js';
import { UIStateVerifier } from '../utils/uiStateVerifier.js';
import { MockDataGenerator } from '../fixtures/mockData.js';

test.describe('Basic Message Flow', () => {
    test('should send and display messages correctly', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);
        const ui = new UIStateVerifier(webviewPage);

        // Verify initial state - should have welcome message
        await ui.verifyMessageCount(1);
        await ui.verifyMessageContent(0, "您好！我是您的 AI 助手");

        // Clear message log
        await injector.clearMessageLog();

        // Type and send a message
        await ui.typeMessage('Hello, can you help me?');
        await ui.clickSend();

        // Verify message was sent to extension
        const sentMessages = await injector.getMessagesSentToExtension();
        const sendMessage = sentMessages.find(m => m.command === 'sendMessage');
        expect(sendMessage).toBeDefined();
        expect(sendMessage).toEqual({
            command: 'sendMessage',
            text: 'Hello, can you help me?',
            images: undefined,
            force: false
        });

        // Verify input field is cleared but enabled (can send more messages while streaming)
        await ui.verifyInputState(true, false); // Empty but enabled

        // Simulate assistant response
        const messages = [
            MockDataGenerator.createUserMessage('Hello, can you help me?'),
            MockDataGenerator.createAssistantMessage('Yes, I can help you with your project!')
        ];

        await injector.updateMessages(messages);

        // End streaming to restore UI state (simulates agent.sendMessage() completion)
        await injector.endStreaming();

        // Verify both messages are displayed
        await ui.verifyMessageCount(3); // Welcome + user + assistant
        await ui.verifyMessageContent(1, 'Hello, can you help me?');
        await ui.verifyMessageContent(2, 'Yes, I can help you');
        
        // Verify message roles
        await ui.verifyMessageRole(1, 'user');
        await ui.verifyMessageRole(2, 'assistant');

        // After response, input should be re-enabled
        await ui.verifyInputState(true, false); // Empty but enabled
    });

    test('should handle multiple message exchanges', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);
        const ui = new UIStateVerifier(webviewPage);

        // Simulate a conversation
        const conversation = MockDataGenerator.createSampleConversation();
        await injector.updateMessages(conversation);

        // Verify all messages are displayed
        await ui.verifyMessageCount(5); // Welcome + 4 conversation messages
        
        // Verify the conversation flow
        await ui.verifyMessageContent(1, 'Hello, can you help me');
        await ui.verifyMessageContent(2, 'I\'d be happy to help');
        await ui.verifyMessageContent(3, 'Can you read the package.json');
        await ui.verifyMessageContent(4, 'I\'ll read the package.json');
    });

    test('should maintain input functionality after messages', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);
        const ui = new UIStateVerifier(webviewPage);

        // Send initial message
        await ui.sendMessage('First message');

        // Simulate response
        const messages = [
            MockDataGenerator.createUserMessage('First message'),
            MockDataGenerator.createAssistantMessage('Response to first message')
        ];
        await injector.updateMessages(messages);

        // End streaming to restore UI state
        await injector.endStreaming();

        // Verify input is still functional
        await ui.verifyInputState(true, false); // Empty but enabled
        await ui.verifySendButtonVisible(true);

        // Send another message
        await injector.clearMessageLog();
        await ui.sendMessage('Second message');

        // Verify second message was sent
        const sentMessages = await injector.getMessagesSentToExtension();
        const sendMessage = sentMessages.find(m => m.command === 'sendMessage');
        expect(sendMessage).toBeDefined();
        expect(sendMessage.text).toBe('Second message');
    });
});