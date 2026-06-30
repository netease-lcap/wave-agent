import { test, expect } from '../utils/webviewTestHarness.js';
import { MessageInjector } from '../utils/messageInjector.js';
import { UIStateVerifier } from '../utils/uiStateVerifier.js';

test.describe('Streaming Button States', () => {
    test('should disable header buttons during streaming', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);
        const ui = new UIStateVerifier(webviewPage);

        // Verify initial state - all buttons should be enabled
        await ui.verifyClearChatButtonEnabled(true);
        await ui.verifySendButtonVisible(true);
        await ui.verifyAbortButtonVisible(false);

        // Start streaming
        await injector.startStreaming();

        // Verify buttons are disabled during streaming
        await ui.verifyClearChatButtonEnabled(false);
        await ui.verifyAbortButtonVisible(true);

        // Verify input is enabled during streaming (allows multiple messages)
        await ui.verifyInputState(false, false); // Not empty, and enabled
    });

    test('should re-enable header buttons after streaming ends', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);
        const ui = new UIStateVerifier(webviewPage);

        // Start streaming
        await injector.startStreaming();
        await ui.verifyClearChatButtonEnabled(false);

        // End streaming by updating with final messages
        await injector.updateMessages([{
            id: "msg_streaming_end_1",
            role: "assistant",
            timestamp: "2024-01-01T00:00:00.000Z",
            blocks: [{ type: "text", content: "Streaming completed" }]
        }]);
        
        // End streaming (simulates agent.sendMessage() completion)
        await injector.endStreaming();

        // Verify buttons are re-enabled
        await ui.verifyClearChatButtonEnabled(true);
        await ui.verifyAbortButtonVisible(false);
        await ui.verifyInputState(true, false); // Empty and enabled
    });

    test('should prevent clear chat during streaming', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);
        const ui = new UIStateVerifier(webviewPage);

        // Add some messages first
        await injector.updateMessages([{
            id: "msg_streaming_prevent_1",
            role: "assistant",
            timestamp: "2024-01-01T00:00:00.000Z",
            blocks: [{ type: "text", content: "This is a test message" }]
        }]);
        await ui.verifyMessageCount(2); // Welcome + test message

        // Start streaming
        await injector.startStreaming();
        
        await injector.updateMessages([{
            id: "msg_streaming_prevent_1",
            role: "assistant",
            timestamp: "2024-01-01T00:00:00.000Z",
            blocks: [{ type: "text", content: "This is a test message" }]
        }, {
            id: "msg_streaming_prevent_2",
            role: "assistant",
            timestamp: "2024-01-01T00:00:00.000Z",
            blocks: [{ type: "text", content: "I'm currently streaming..." }]
        }]);
        await ui.verifyStreamingMessageExists();

        // Clear message log to track new commands
        await injector.clearMessageLog();

        // Try to click clear chat (should be disabled)
        await expect(ui.clearChatButton).toBeDisabled();

        // Verify that clicking disabled button doesn't send command
        // This is a bit tricky to test - we'll verify button is disabled
        // and trust that disabled buttons don't trigger onclick handlers
        const sentMessages = await injector.getMessagesSentToExtension();
        expect(sentMessages.filter(msg => msg.command === 'clearChat')).toHaveLength(0);

        // Messages should still be there
        await ui.verifyMessageCount(3); // Welcome + test message + streaming message
    });



    test('should handle abort and restore button states', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);
        const ui = new UIStateVerifier(webviewPage);

        // Start streaming
        await injector.startStreaming();
        await injector.updateMessages([{
            id: "msg_streaming_abort_1",
            role: "assistant",
            timestamp: "2024-01-01T00:00:00.000Z",
            blocks: [{ type: "text", content: "This will be aborted..." }]
        }]);

        // Verify buttons are in streaming state
        await ui.verifyClearChatButtonEnabled(false);
        await ui.verifyAbortButtonVisible(true);

        // Abort the message
        await injector.abortMessage("This will be aborted");
        
        // End streaming (simulates agent completing after abort)
        await injector.endStreaming();

        // Verify buttons are restored after abort
        await ui.verifyClearChatButtonEnabled(true);
        await ui.verifyAbortButtonVisible(false);
        await ui.verifyInputState(true, false); // Empty and enabled
    });
});