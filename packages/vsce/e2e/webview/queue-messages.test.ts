import { test, expect } from '../utils/webviewTestHarness.js';

/**
 * Test message queuing functionality
 */

test.describe('Message Queuing', () => {
  test('should queue messages when streaming and process them after streaming ends', async ({ webviewPage }) => {
    const input = webviewPage.getByTestId('message-input');
    await input.focus();

    // 1. Start streaming
    await webviewPage.evaluate(() => {
      window.simulateExtensionMessage({
        command: 'startStreaming'
      });
    });

    // 2. Verify send button shows "加入队列" and has list-ordered icon
    const sendBtn = webviewPage.getByTestId('send-btn');
    await expect(sendBtn).toHaveAttribute('aria-label', '加入队列');
    const icon = sendBtn.locator('i');
    await expect(icon).toHaveClass(/codicon-list-ordered/);

    // 3. Type and send a message while streaming
    await input.type('Queued message 1');
    await sendBtn.click();

    // 4. Verify sendMessage was called (it should be called even when streaming, 
    // but the extension will handle the queuing)
    const sendMessageCalled = await webviewPage.evaluate(() => {
      const messages = window.getTestMessages();
      return messages.some((m: Record<string, unknown>) => m.command === 'sendMessage' && m.text === 'Queued message 1');
    });
    expect(sendMessageCalled).toBe(true);

    // 5. Simulate queue update from extension
    await webviewPage.evaluate(() => {
      window.simulateExtensionMessage({
        command: 'updateQueue',
        queue: [{ content: 'Queued message 1' }]
      });
    });

    // 6. Verify message is in the queue (visual check)
    const queuePanel = webviewPage.getByTestId('queued-message-list');
    await expect(queuePanel).toBeVisible();
    await expect(queuePanel).toContainText('Queued message 1');
    await expect(queuePanel).toContainText('消息队列');

    // 7. End streaming
    await webviewPage.evaluate(() => {
      window.simulateExtensionMessage({
        command: 'endStreaming'
      });
      // Also clear the queue as the extension would do when processing
      window.simulateExtensionMessage({
        command: 'updateQueue',
        queue: []
      });
    });

    // 8. Verify queue is empty in UI
    await expect(queuePanel).not.toBeVisible();
  });

  test('should NOT clear queue when aborting', async ({ webviewPage }) => {
    const input = webviewPage.getByTestId('message-input');
    await input.focus();

    // 1. Start streaming and queue a message
    await webviewPage.evaluate(() => {
      window.simulateExtensionMessage({
        command: 'startStreaming'
      });
      window.simulateExtensionMessage({
        command: 'updateQueue',
        queue: [{ content: 'Queued message 1' }]
      });
    });

    const queuePanel = webviewPage.getByTestId('queued-message-list');
    await expect(queuePanel).toBeVisible();

    // 2. Click abort button
    const abortBtn = webviewPage.getByTestId('abort-btn');
    await abortBtn.click();

    // 3. Verify abortMessage was sent
    const abortMessageSent = await webviewPage.evaluate(() => {
      const messages = window.getTestMessages();
      return messages.some((m: Record<string, unknown>) => m.command === 'abortMessage');
    });
    expect(abortMessageSent).toBe(true);

    // 4. Verify queue is STILL there in UI (new logic: abort doesn't clear queue)
    await expect(queuePanel).toBeVisible();
    await expect(queuePanel).toContainText('Queued message 1');
  });

  test('should NOT clear queue when pressing Escape', async ({ webviewPage }) => {
    const input = webviewPage.getByTestId('message-input');
    await input.focus();

    // 1. Start streaming and queue a message
    await webviewPage.evaluate(() => {
      window.simulateExtensionMessage({
        command: 'startStreaming'
      });
      window.simulateExtensionMessage({
        command: 'updateQueue',
        queue: [{ content: 'Queued message 1' }]
      });
    });

    const queuePanel = webviewPage.getByTestId('queued-message-list');
    await expect(queuePanel).toBeVisible();

    // 2. Press Escape
    await webviewPage.keyboard.press('Escape');

    // 3. Verify abortMessage was sent
    const abortMessageSent = await webviewPage.evaluate(() => {
      const messages = window.getTestMessages();
      return messages.some((m: Record<string, unknown>) => m.command === 'abortMessage');
    });
    expect(abortMessageSent).toBe(true);

    // 4. Verify queue is STILL there in UI
    await expect(queuePanel).toBeVisible();
    await expect(queuePanel).toContainText('Queued message 1');
  });

  test('should delete a specific queued message when clicking the delete icon', async ({ webviewPage }) => {
    // 1. Start streaming and queue two messages
    await webviewPage.evaluate(() => {
      window.simulateExtensionMessage({
        command: 'startStreaming'
      });
      window.simulateExtensionMessage({
        command: 'updateQueue',
        queue: [
          { content: 'Queued message 1' },
          { content: 'Queued message 2' }
        ]
      });
    });

    const queuePanel = webviewPage.getByTestId('queued-message-list');
    await expect(queuePanel).toBeVisible();
    await expect(queuePanel).toContainText('Queued message 1');
    await expect(queuePanel).toContainText('Queued message 2');

    // 2. Find and click the delete button for the first queued message
    const deleteButtons = queuePanel.locator('.action-button.delete-queued');
    await expect(deleteButtons).toHaveCount(2);
    await deleteButtons.first().click();

    // 3. Verify deleteQueuedMessage was sent to extension with correct index
    const deleteMessageSent = await webviewPage.evaluate(() => {
      const messages = window.getTestMessages();
      return messages.some((m: Record<string, unknown>) => m.command === 'deleteQueuedMessage' && m.index === 0);
    });
    expect(deleteMessageSent).toBe(true);

    // 4. Verify local state update (the message should be gone from UI immediately)
    await expect(queuePanel).not.toContainText('Queued message 1');
    await expect(queuePanel).toContainText('Queued message 2');
    await expect(deleteButtons).toHaveCount(1);
  });

  test('should render mention tags and image tags in queued messages', async ({ webviewPage }) => {
    // 1. Start streaming to enable queuing
    await webviewPage.evaluate(() => {
      window.simulateExtensionMessage({
        command: 'startStreaming'
      });
    });

    // 2. Simulate queue update with a message containing a mention tag and an image tag
    await webviewPage.evaluate(() => {
      window.simulateExtensionMessage({
        command: 'updateQueue',
        queue: [
          { 
            content: 'Check this file [@file:src/main.ts] and this image [image1]',
            images: [{ path: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', mimeType: 'image/png' }]
          }
        ]
      });
    });

    // 3. Verify the queue panel is visible
    const queuePanel = webviewPage.getByTestId('queued-message-list');
    await expect(queuePanel).toBeVisible();

    // 4. Verify the mention tag is rendered as a ContextTag
    const mentionTag = queuePanel.locator('.context-tag').filter({ hasText: 'main.ts' });
    await expect(mentionTag).toBeVisible();

    // 5. Verify the image tag is rendered as a ContextTag
    const imageTag = queuePanel.locator('.context-tag').filter({ hasText: '图片 1' });
    await expect(imageTag).toBeVisible();

    // 6. Verify the text around tags is also rendered
    await expect(queuePanel).toContainText('Check this file');
    await expect(queuePanel).toContainText('and this image');
  });

  test('should render selection tags in queued messages', async ({ webviewPage }) => {
    // 1. Start streaming
    await webviewPage.evaluate(() => {
      window.simulateExtensionMessage({
        command: 'startStreaming'
      });
    });

    // 2. Simulate queue update with a selection tag
    await webviewPage.evaluate(() => {
      window.simulateExtensionMessage({
        command: 'updateQueue',
        queue: [
          { 
            content: 'Look at this selection: [Selection: src/utils.ts|utils.ts#10-20]',
          }
        ]
      });
    });

    // 3. Verify the selection tag is rendered as a ContextTag
    const queuePanel = webviewPage.getByTestId('queued-message-list');
    const selectionTag = queuePanel.locator('.context-tag').filter({ hasText: 'utils.ts#10-20' });
    await expect(selectionTag).toBeVisible();
  });
});
