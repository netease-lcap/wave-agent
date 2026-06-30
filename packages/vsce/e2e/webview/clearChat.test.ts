import { test, expect } from '../utils/webviewTestHarness.js';
import { MessageInjector } from '../utils/messageInjector.js';
import { UIStateVerifier } from '../utils/uiStateVerifier.js';
import { MockDataGenerator } from '../fixtures/mockData.js';

test.describe('Clear Chat Functionality', () => {
    test('should clear all messages except welcome message', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);
        const ui = new UIStateVerifier(webviewPage);

        // Add some conversation messages
        const conversation = MockDataGenerator.createSampleConversation();
        await injector.updateMessages(conversation);

        // Verify messages are present
        await ui.verifyMessageCount(5); // Welcome + 4 conversation messages

        // Clear chat
        await injector.clearMessages();

        // Verify only welcome message remains
        await ui.verifyChatCleared();
    });

    test('should trigger clear chat via header button', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);
        const ui = new UIStateVerifier(webviewPage);

        // Add some messages
        await injector.updateMessages([
            MockDataGenerator.createUserMessage('Test message 1'),
            MockDataGenerator.createAssistantMessage('Response 1'),
            MockDataGenerator.createUserMessage('Test message 2')
        ]);

        await ui.verifyMessageCount(4); // Welcome + 3 messages

        // Clear message log to track new commands
        await injector.clearMessageLog();

        // Find and click the clear chat button using test data attribute
        await ui.clickClearChat();

        // Verify clear command was sent to extension
        const sentMessages = await injector.getMessagesSentToExtension();
        const clearMessage = sentMessages.find(msg => msg.command === 'clearChat');
        expect(clearMessage).toBeDefined();
    });

    test('should reset input state after clearing', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);
        const ui = new UIStateVerifier(webviewPage);

        // Add messages and type something in input
        await injector.updateMessages([
            MockDataGenerator.createUserMessage('Hello'),
            MockDataGenerator.createAssistantMessage('Hi!')
        ]);

        await ui.typeMessage('This text should be preserved');
        await expect(ui.messageInput).toHaveText('This text should be preserved');

        // Clear chat
        await injector.clearMessages();

        // Verify input text is preserved but state is reset
        await expect(ui.messageInput).toHaveText('This text should be preserved'); // Input preserved
        await ui.verifyInputState(false, false); // Not empty but enabled
        await ui.verifySendButtonVisible(true);
        await ui.verifyAbortButtonVisible(false);
    });

    test('should prevent user from clearing during streaming but allow extension clear', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);
        const ui = new UIStateVerifier(webviewPage);

        // Start streaming
        await injector.startStreaming();
        await injector.updateMessages([{
            id: "msg_streaming_clear",
            role: "assistant",
            timestamp: "2024-01-01T00:00:00.000Z",
            blocks: [{ type: "text", content: "This is being streamed..." }]
        }]);
        
        await ui.verifyStreamingMessageExists();
        await ui.verifyAbortButtonVisible(true);

        // Verify clear button is disabled
        await ui.verifyClearChatButtonEnabled(false);

        // But extension can still clear messages via injector (simulating extension command)
        await injector.clearMessages();

        // Verify chat is cleared but streaming state is preserved (since streaming is independent of clearing)
        await ui.verifyChatCleared();
        // Streaming state should still be active since clearing doesn't affect streaming
        await ui.verifyAbortButtonVisible(true);
        
        // End streaming separately
        await injector.endStreaming();
        await ui.verifyAbortButtonVisible(false);
    });

    test('should clear error messages', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);
        const ui = new UIStateVerifier(webviewPage);

        // Add normal message and error
        await injector.updateMessages([
            MockDataGenerator.createUserMessage('Help me with this'),
            MockDataGenerator.createErrorMessage('Something went wrong')
        ]);

        // Verify messages and error are present
        await ui.verifyMessageCount(3); // Welcome + user + error
        await ui.verifyErrorMessageDisplayed('Something went wrong');

        // Clear chat
        await injector.clearMessages();

        // Verify everything is cleared
        await ui.verifyChatCleared();
        
        // Error message should no longer be visible
        await expect(webviewPage.locator('.message-content')).not.toContainText('Something went wrong');
    });

    test('should allow new conversation after clearing', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);
        const ui = new UIStateVerifier(webviewPage);

        // Have a conversation
        await injector.updateMessages([
            MockDataGenerator.createUserMessage('Old conversation'),
            MockDataGenerator.createAssistantMessage('Old response')
        ]);

        // Clear it
        await injector.clearMessages();
        await ui.verifyChatCleared();

        // Start new conversation
        await injector.clearMessageLog();
        await ui.sendMessage('New conversation after clear');

        // Verify new message was sent
        const sentMessages = await injector.getMessagesSentToExtension();
        const sendMessage = sentMessages.find(m => m.command === 'sendMessage');
        expect(sendMessage).toBeDefined();
        expect(sendMessage.text).toBe('New conversation after clear');

        // Simulate response
        await injector.updateMessages([
            MockDataGenerator.createUserMessage('New conversation after clear'),
            MockDataGenerator.createAssistantMessage('Fresh start!')
        ]);

        // Verify new conversation
        await ui.verifyMessageCount(3); // Welcome + new user + new assistant
        await ui.verifyMessageContent(1, 'New conversation after clear');
        await ui.verifyMessageContent(2, 'Fresh start!');

        // Should not contain old conversation content
        const messagesContainer = ui.messagesContainer;
        await expect(messagesContainer).not.toContainText('Old conversation');
        await expect(messagesContainer).not.toContainText('Old response');
    });
});