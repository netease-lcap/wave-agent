import { describe, it, expect, beforeEach } from 'vitest';
import { renderChatApp, screen, fireEvent, sendCommand, fireInput } from './test-utils';

/**
 * Helper: set contenteditable text and fire input event
 */
async function typeMessage(text: string) {
    const input = screen.getByTestId('message-input');
    input.textContent = text;
    await fireInput(input, { inputType: 'insertText' });
}

/**
 * Helper: click the send button
 */
function clickSend() {
    fireEvent.click(screen.getByTestId('send-btn'));
}

describe('Message Queue Features', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should send first queued message when Enter is pressed on empty input', () => {
        const { vscode } = renderChatApp();

        // 1. Start streaming to enable queuing
        sendCommand('startStreaming');

        // 2. Add a message to the queue
        const queuedText = 'Queued message 1';
        sendCommand('updateQueue', { queue: [{ content: queuedText }] });

        // Verify it's in the new UI (QueuedMessageList)
        const queuePanel = screen.getByTestId('queued-message-list');
        expect(queuePanel).toBeInTheDocument();
        expect(queuePanel).toHaveTextContent(queuedText);

        // 3. Clear message log
        vscode.postMessage.mockClear();

        // 4. Press Enter on empty input
        const input = screen.getByTestId('message-input');
        input.focus();
        fireEvent.keyDown(input, { key: 'Enter' });

        // 5. Verify sendMessage was sent (backend handles priority)
        const sentMessages = vscode.postMessage.mock.calls.map(c => c[0]);
        const sendMsg = sentMessages.find((m: Record<string, unknown>) => m.command === 'sendMessage');
        expect(sendMsg).toBeDefined();
        expect(sendMsg.text).toBe(queuedText);

        // 6. Verify it's removed from queue in UI
        expect(screen.queryByTestId('queued-message-list')).not.toBeInTheDocument();
    });

    it('should send specific queued message when play icon is clicked', () => {
        const { vscode } = renderChatApp();

        // 1. Start streaming
        sendCommand('startStreaming');

        // 2. Add multiple messages to the queue
        sendCommand('updateQueue', {
            queue: [
                { content: 'Queued 1' },
                { content: 'Queued 2' }
            ]
        });

        const queuePanel = screen.getByTestId('queued-message-list');
        const queuedItems = queuePanel.querySelectorAll('.queued-item');
        expect(queuedItems).toHaveLength(2);

        // 3. Clear message log
        vscode.postMessage.mockClear();

        // 4. Click the play icon on the first queued message (only first has it)
        const firstQueuedMessage = queuedItems[0];
        const playButton = firstQueuedMessage.querySelector('.send-now') as HTMLElement;
        fireEvent.click(playButton);

        // 5. Verify sendMessage was sent
        const sentMessages = vscode.postMessage.mock.calls.map(c => c[0]);
        const sendMsg = sentMessages.find((m: Record<string, unknown>) => m.command === 'sendMessage');
        expect(sendMsg).toBeDefined();
        expect(sendMsg.text).toBe('Queued 1');

        // 6. Verify only one message remains in queue
        const remainingItems = queuePanel.querySelectorAll('.queued-item');
        expect(remainingItems).toHaveLength(1);
        expect(queuePanel).toHaveTextContent('Queued 2');
    });

    it('abort should NOT clear the queue', () => {
        renderChatApp();

        sendCommand('startStreaming');
        sendCommand('updateQueue', { queue: [{ content: 'Queued 1' }] });

        const queuePanel = screen.getByTestId('queued-message-list');
        expect(queuePanel).toBeInTheDocument();

        // Abort current message
        fireEvent.click(screen.getByTestId('abort-btn'));

        // Verify queue is still there
        expect(queuePanel).toBeInTheDocument();
        expect(queuePanel).toHaveTextContent('Queued 1');
    });

    it('new message should prioritize over queue when not streaming', async () => {
        const { vscode } = renderChatApp();

        // 1. Have a queue but NOT streaming
        sendCommand('updateQueue', { queue: [{ content: 'Queued 1' }] });

        // 2. Send a new message
        vscode.postMessage.mockClear();
        await typeMessage('New Message');
        clickSend();

        // 3. Verify 'New Message' is sent (backend handles priority)
        const sentMessages = vscode.postMessage.mock.calls.map(c => c[0]);
        const sendMsg = sentMessages.find((m: Record<string, unknown>) => m.command === 'sendMessage' && m.text === 'New Message');
        expect(sendMsg).toBeDefined();
    });
});
