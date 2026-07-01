import { describe, it, expect, beforeEach } from 'vitest';
import { renderChatApp, screen, fireEvent, sendCommand } from './test-utils';

/**
 * Helper: set contenteditable text and fire input event
 */
function typeMessage(text: string) {
    const input = screen.getByTestId('message-input');
    input.textContent = text;
    fireEvent.input(input, { inputType: 'insertText' });
}

describe('Message Queuing', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should queue messages when streaming and process them after streaming ends', () => {
        const { vscode } = renderChatApp();

        const input = screen.getByTestId('message-input');
        input.focus();

        // 1. Start streaming
        sendCommand('startStreaming');

        // 2. Verify send button shows "加入队列" and has list-ordered icon
        const sendBtn = screen.getByTestId('send-btn');
        expect(sendBtn).toHaveAttribute('aria-label', '加入队列');
        const icon = sendBtn.querySelector('i');
        expect(icon?.className).toMatch(/codicon-list-ordered/);

        // 3. Type and send a message while streaming
        typeMessage('Queued message 1');
        fireEvent.click(sendBtn);

        // 4. Verify sendMessage was called (it should be called even when streaming,
        // but the extension will handle the queuing)
        const sentMessages = vscode.postMessage.mock.calls.map(c => c[0]);
        const sendMessageCalled = sentMessages.some((m: Record<string, unknown>) => m.command === 'sendMessage' && m.text === 'Queued message 1');
        expect(sendMessageCalled).toBe(true);

        // 5. Simulate queue update from extension
        sendCommand('updateQueue', { queue: [{ content: 'Queued message 1' }] });

        // 6. Verify message is in the queue (visual check)
        const queuePanel = screen.getByTestId('queued-message-list');
        expect(queuePanel).toBeInTheDocument();
        expect(queuePanel).toHaveTextContent('Queued message 1');
        expect(queuePanel).toHaveTextContent('消息队列');

        // 7. End streaming
        sendCommand('endStreaming');
        // Also clear the queue as the extension would do when processing
        sendCommand('updateQueue', { queue: [] });

        // 8. Verify queue is empty in UI
        expect(screen.queryByTestId('queued-message-list')).not.toBeInTheDocument();
    });

    it('should NOT clear queue when aborting', () => {
        const { vscode } = renderChatApp();

        const input = screen.getByTestId('message-input');
        input.focus();

        // 1. Start streaming and queue a message
        sendCommand('startStreaming');
        sendCommand('updateQueue', { queue: [{ content: 'Queued message 1' }] });

        const queuePanel = screen.getByTestId('queued-message-list');
        expect(queuePanel).toBeInTheDocument();

        // 2. Click abort button
        fireEvent.click(screen.getByTestId('abort-btn'));

        // 3. Verify abortMessage was sent
        const sentMessages = vscode.postMessage.mock.calls.map(c => c[0]);
        const abortMessageSent = sentMessages.some((m: Record<string, unknown>) => m.command === 'abortMessage');
        expect(abortMessageSent).toBe(true);

        // 4. Verify queue is STILL there in UI (new logic: abort doesn't clear queue)
        expect(queuePanel).toBeInTheDocument();
        expect(queuePanel).toHaveTextContent('Queued message 1');
    });

    it('should NOT clear queue when pressing Escape', () => {
        const { vscode } = renderChatApp();

        const input = screen.getByTestId('message-input');
        input.focus();

        // 1. Start streaming and queue a message
        sendCommand('startStreaming');
        sendCommand('updateQueue', { queue: [{ content: 'Queued message 1' }] });

        const queuePanel = screen.getByTestId('queued-message-list');
        expect(queuePanel).toBeInTheDocument();

        // 2. Press Escape
        fireEvent.keyDown(input, { key: 'Escape' });

        // 3. Verify abortMessage was sent
        const sentMessages = vscode.postMessage.mock.calls.map(c => c[0]);
        const abortMessageSent = sentMessages.some((m: Record<string, unknown>) => m.command === 'abortMessage');
        expect(abortMessageSent).toBe(true);

        // 4. Verify queue is STILL there in UI
        expect(queuePanel).toBeInTheDocument();
        expect(queuePanel).toHaveTextContent('Queued message 1');
    });

    it('should delete a specific queued message when clicking the delete icon', () => {
        const { vscode } = renderChatApp();

        // 1. Start streaming and queue two messages
        sendCommand('startStreaming');
        sendCommand('updateQueue', {
            queue: [
                { content: 'Queued message 1' },
                { content: 'Queued message 2' }
            ]
        });

        const queuePanel = screen.getByTestId('queued-message-list');
        expect(queuePanel).toBeInTheDocument();
        expect(queuePanel).toHaveTextContent('Queued message 1');
        expect(queuePanel).toHaveTextContent('Queued message 2');

        // 2. Find and click the delete button for the first queued message
        const deleteButtons = queuePanel.querySelectorAll('.action-button.delete-queued');
        expect(deleteButtons).toHaveLength(2);
        fireEvent.click(deleteButtons[0]);

        // 3. Verify deleteQueuedMessage was sent to extension with correct index
        const sentMessages = vscode.postMessage.mock.calls.map(c => c[0]);
        const deleteMessageSent = sentMessages.some((m: Record<string, unknown>) => m.command === 'deleteQueuedMessage' && m.index === 0);
        expect(deleteMessageSent).toBe(true);

        // 4. Verify local state update (the message should be gone from UI immediately)
        expect(queuePanel).not.toHaveTextContent('Queued message 1');
        expect(queuePanel).toHaveTextContent('Queued message 2');
        const remainingDeleteButtons = queuePanel.querySelectorAll('.action-button.delete-queued');
        expect(remainingDeleteButtons).toHaveLength(1);
    });

    it('should render mention tags and image tags in queued messages', () => {
        renderChatApp();

        // 1. Start streaming to enable queuing
        sendCommand('startStreaming');

        // 2. Simulate queue update with a message containing a mention tag and an image tag
        sendCommand('updateQueue', {
            queue: [
                {
                    content: 'Check this file [@file:src/main.ts] and this image [image1]',
                    images: [{ path: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', mimeType: 'image/png' }]
                }
            ]
        });

        // 3. Verify the queue panel is visible
        const queuePanel = screen.getByTestId('queued-message-list');
        expect(queuePanel).toBeInTheDocument();

        // 4. Verify the mention tag is rendered as a ContextTag
        const contextTags = queuePanel.querySelectorAll('.context-tag');
        const mentionTag = Array.from(contextTags).find(el => el.textContent?.includes('main.ts'));
        expect(mentionTag).toBeDefined();

        // 5. Verify the image tag is rendered as a ContextTag
        const imageTag = Array.from(contextTags).find(el => el.textContent?.includes('图片 1'));
        expect(imageTag).toBeDefined();

        // 6. Verify the text around tags is also rendered
        expect(queuePanel).toHaveTextContent('Check this file');
        expect(queuePanel).toHaveTextContent('and this image');
    });

    it('should render selection tags in queued messages', () => {
        renderChatApp();

        // 1. Start streaming
        sendCommand('startStreaming');

        // 2. Simulate queue update with a selection tag
        sendCommand('updateQueue', {
            queue: [
                {
                    content: 'Look at this selection: [Selection: src/utils.ts|utils.ts#10-20]',
                }
            ]
        });

        // 3. Verify the selection tag is rendered as a ContextTag
        const queuePanel = screen.getByTestId('queued-message-list');
        const contextTags = queuePanel.querySelectorAll('.context-tag');
        const selectionTag = Array.from(contextTags).find(el => el.textContent?.includes('utils.ts#10-20'));
        expect(selectionTag).toBeDefined();
    });
});
