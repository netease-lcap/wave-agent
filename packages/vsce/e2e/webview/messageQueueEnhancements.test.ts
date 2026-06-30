import { test, expect } from '../utils/webviewTestHarness.js';
import { MessageInjector } from '../utils/messageInjector.js';
import { UIStateVerifier } from '../utils/uiStateVerifier.js';

test.describe('Message Queue Features', () => {
    test('should send first queued message when Enter is pressed on empty input', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);
        const ui = new UIStateVerifier(webviewPage);

        // 1. Start streaming to enable queuing
        await injector.startStreaming();
        
        // 2. Add a message to the queue
        const queuedText = 'Queued message 1';
        await injector.updateQueue([{ content: queuedText }]);
        
        // Verify it's in the new UI (QueuedMessageList)
        const queuePanel = webviewPage.getByTestId('queued-message-list');
        await expect(queuePanel).toBeVisible();
        await expect(queuePanel).toContainText(queuedText);

        // 3. Clear message log
        await injector.clearMessageLog();

        // 4. Press Enter on empty input
        await ui.messageInput.focus();
        await webviewPage.keyboard.press('Enter');

        // 5. Verify sendMessage was sent (backend handles priority)
        const sentMessages = await injector.getMessagesSentToExtension();
        const sendMsg = sentMessages.find(m => m.command === 'sendMessage');
        expect(sendMsg).toBeDefined();
        expect(sendMsg.text).toBe(queuedText);
        
        // 6. Verify it's removed from queue in UI
        await expect(queuePanel).not.toBeVisible();
    });

    test('should send specific queued message when play icon is clicked', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);

        // 1. Start streaming
        await injector.startStreaming();
        
        // 2. Add multiple messages to the queue
        await injector.updateQueue([
            { content: 'Queued 1' },
            { content: 'Queued 2' }
        ]);
        
        const queuePanel = webviewPage.getByTestId('queued-message-list');
        await expect(queuePanel.locator('.queued-item')).toHaveCount(2);

        // 3. Clear message log
        await injector.clearMessageLog();

        // 4. Click the play icon on the first queued message (only first has it)
        const firstQueuedMessage = queuePanel.locator('.queued-item').first();
        const playButton = firstQueuedMessage.locator('.send-now');
        await playButton.click();

        // 5. Verify sendMessage was sent
        const sentMessages = await injector.getMessagesSentToExtension();
        const sendMsg = sentMessages.find(m => m.command === 'sendMessage');
        expect(sendMsg).toBeDefined();
        expect(sendMsg.text).toBe('Queued 1');
        
        // 6. Verify only one message remains in queue
        await expect(queuePanel.locator('.queued-item')).toHaveCount(1);
        await expect(queuePanel).toContainText('Queued 2');
    });

    test('abort should NOT clear the queue', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);
        const ui = new UIStateVerifier(webviewPage);

        await injector.startStreaming();
        await injector.updateQueue([{ content: 'Queued 1' }]);
        
        const queuePanel = webviewPage.getByTestId('queued-message-list');
        await expect(queuePanel).toBeVisible();

        // Abort current message
        await ui.clickAbort();

        // Verify queue is still there
        await expect(queuePanel).toBeVisible();
        await expect(queuePanel).toContainText('Queued 1');
    });

    test('new message should prioritize over queue when not streaming', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);
        const ui = new UIStateVerifier(webviewPage);

        // 1. Have a queue but NOT streaming
        await injector.updateQueue([{ content: 'Queued 1' }]);
        
        // 2. Send a new message
        await injector.clearMessageLog();
        await ui.sendMessage('New Message');

        // 3. Verify 'New Message' is sent (backend handles priority)
        const sentMessages = await injector.getMessagesSentToExtension();
        const sendMsg = sentMessages.find(m => m.command === 'sendMessage' && m.text === 'New Message');
        expect(sendMsg).toBeDefined();
    });
});
