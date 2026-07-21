import { describe, it, expect, beforeEach } from 'vitest';
import { renderChatApp, screen, fireEvent, sendCommand, fireInput, within } from './test-utils';

/**
 * Helper: set contenteditable text and fire input event
 */
async function typeMessage(text: string) {
    const input = screen.getByTestId('message-input');
    input.textContent = text;
    await fireInput(input, { inputType: 'insertText' });
}

/**
 * Read the visible (non-tooltip) text of a queued item. The Tooltip wrapper
 * always renders a hidden copy of the text in a `.tooltip-box`, so we scope to
 * the `.queued-item-text` span to get the single visible copy.
 */
function itemText(id: string): string {
    const item = screen.getByTestId(`queued-item-${id}`);
    return item.querySelector('.queued-item-text')?.textContent ?? '';
}

describe('Message Queuing', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should queue messages when streaming and process them after streaming ends', async () => {
        const { vscode } = renderChatApp();

        const input = screen.getByTestId('message-input');
        input.focus();

        // 0. Before streaming the send button is rendered with an SVG icon
        //    (no codicon), and the abort button is absent.
        const initialSendBtn = screen.getByTestId('send-btn');
        expect(initialSendBtn).toHaveClass('send-button', 'ai-send-btn');
        expect(initialSendBtn).toHaveAttribute('aria-label', '发送');
        expect(initialSendBtn.querySelector('svg')).toBeInTheDocument();
        expect(screen.queryByTestId('abort-btn')).not.toBeInTheDocument();

        // 1. Start streaming
        sendCommand('startStreaming');

        // 2. While streaming the send button is not rendered; only the abort
        //    button is present (conditional render, not display toggle).
        expect(screen.queryByTestId('send-btn')).not.toBeInTheDocument();
        const abortBtn = screen.getByTestId('abort-btn');
        expect(abortBtn.querySelector('.abort-glyph')).toBeInTheDocument();

        // 3. Type and send a message while streaming (Enter submits; the
        //    extension queues it since streaming is in progress)
        await typeMessage('Queued message 1');
        fireEvent.keyDown(input, { key: 'Enter' });

        // 4. Verify sendMessage was called (extension handles the queuing)
        const sentMessages = vscode.postMessage.mock.calls.map(c => c[0]);
        const sendMessageCalled = sentMessages.some((m: Record<string, unknown>) => m.command === 'sendMessage' && m.text === 'Queued message 1');
        expect(sendMessageCalled).toBe(true);

        // 5. Simulate queue update from extension
        sendCommand('updateQueue', { queue: [{ id: 'q1', content: 'Queued message 1' }] });

        // 6. Verify message is in the queue (visual check)
        const queuePanel = screen.getByTestId('queued-message-list');
        expect(queuePanel).toBeInTheDocument();
        expect(itemText('q1')).toBe('Queued message 1');
        expect(queuePanel).toHaveTextContent('消息队列 (1)');

        // 7. End streaming and clear the queue as the extension would
        sendCommand('endStreaming');
        sendCommand('updateQueue', { queue: [] });

        // 8. Verify queue is empty in UI
        expect(screen.queryByTestId('queued-message-list')).not.toBeInTheDocument();
    });

    it('should NOT clear queue when aborting', () => {
        const { vscode } = renderChatApp();

        const input = screen.getByTestId('message-input');
        input.focus();

        sendCommand('startStreaming');
        sendCommand('updateQueue', { queue: [{ id: 'q1', content: 'Queued message 1' }] });

        const queuePanel = screen.getByTestId('queued-message-list');
        expect(queuePanel).toBeInTheDocument();

        fireEvent.click(screen.getByTestId('abort-btn'));

        const sentMessages = vscode.postMessage.mock.calls.map(c => c[0]);
        const abortMessageSent = sentMessages.some((m: Record<string, unknown>) => m.command === 'abortMessage');
        expect(abortMessageSent).toBe(true);

        // Queue is STILL there (abort doesn't clear queue)
        expect(queuePanel).toBeInTheDocument();
        expect(itemText('q1')).toBe('Queued message 1');
    });

    it('should NOT clear queue when pressing Escape', () => {
        const { vscode } = renderChatApp();

        const input = screen.getByTestId('message-input');
        input.focus();

        sendCommand('startStreaming');
        sendCommand('updateQueue', { queue: [{ id: 'q1', content: 'Queued message 1' }] });

        const queuePanel = screen.getByTestId('queued-message-list');
        expect(queuePanel).toBeInTheDocument();

        fireEvent.keyDown(input, { key: 'Escape' });

        const sentMessages = vscode.postMessage.mock.calls.map(c => c[0]);
        const abortMessageSent = sentMessages.some((m: Record<string, unknown>) => m.command === 'abortMessage');
        expect(abortMessageSent).toBe(true);

        expect(queuePanel).toBeInTheDocument();
        expect(itemText('q1')).toBe('Queued message 1');
    });

    it('should delete a specific queued message by id when clicking the delete icon', () => {
        const { vscode } = renderChatApp();

        sendCommand('startStreaming');
        sendCommand('updateQueue', {
            queue: [
                { id: 'q1', content: 'Queued message 1' },
                { id: 'q2', content: 'Queued message 2' }
            ]
        });

        // Expand to see both items (default collapsed shows only the first).
        fireEvent.click(screen.getByTestId('queued-message-list').querySelector('.queued-message-list-header') as HTMLElement);

        expect(itemText('q1')).toBe('Queued message 1');
        expect(itemText('q2')).toBe('Queued message 2');

        // Click the delete button for the first queued message
        fireEvent.click(screen.getByTestId('queued-delete-q1'));

        // deleteQueuedMessageById sent with the correct id
        const sentMessages = vscode.postMessage.mock.calls.map(c => c[0]);
        const deleteMessageSent = sentMessages.some((m: Record<string, unknown>) => m.command === 'deleteQueuedMessageById' && m.id === 'q1');
        expect(deleteMessageSent).toBe(true);

        // Optimistic local removal
        expect(screen.queryByTestId('queued-item-q1')).not.toBeInTheDocument();
        expect(itemText('q2')).toBe('Queued message 2');
    });

    it('should force-send a specific queued message by id when clicking the ↑ send icon', () => {
        const { vscode } = renderChatApp();

        sendCommand('startStreaming');
        sendCommand('updateQueue', {
            queue: [
                { id: 'q1', content: 'Queued message 1' },
                { id: 'q2', content: 'Queued message 2' }
            ]
        });

        // Expand to see both items (default collapsed shows only the first).
        fireEvent.click(screen.getByTestId('queued-message-list').querySelector('.queued-message-list-header') as HTMLElement);

        // Click the ↑ send-now button for the second queued message
        fireEvent.click(screen.getByTestId('queued-send-q2'));

        const sentMessages = vscode.postMessage.mock.calls.map(c => c[0]);

        // force-send: sendMessage with the item's text and force:true
        const sendMessageSent = sentMessages.some(
            (m: Record<string, unknown>) => m.command === 'sendMessage' && m.text === 'Queued message 2' && m.force === true
        );
        expect(sendMessageSent).toBe(true);

        // followed by removal from the queue by id
        const deleteMessageSent = sentMessages.some(
            (m: Record<string, unknown>) => m.command === 'deleteQueuedMessageById' && m.id === 'q2'
        );
        expect(deleteMessageSent).toBe(true);

        // Optimistic local removal of the sent item; the other remains
        expect(screen.queryByTestId('queued-item-q2')).not.toBeInTheDocument();
        expect(itemText('q1')).toBe('Queued message 1');
    });

    it('should display bang commands with ! prefix in the queue', () => {
        renderChatApp();

        sendCommand('startStreaming');
        sendCommand('updateQueue', {
            queue: [
                { id: 'q1', type: 'bang', content: 'ls -la' },
                { id: 'q2', type: 'message', content: 'normal message' }
            ]
        });

        expect(screen.getByTestId('queued-message-list')).toBeInTheDocument();

        // Expand to render all items
        fireEvent.click(screen.getByTestId('queued-message-list').querySelector('.queued-message-list-header') as HTMLElement);

        // Bang command displays with ! prefix; normal message without
        expect(itemText('q1')).toBe('!ls -la');
        expect(itemText('q2')).toBe('normal message');
    });

    it('should wrap each item in a Tooltip showing the full text', () => {
        renderChatApp();

        sendCommand('startStreaming');
        sendCommand('updateQueue', { queue: [{ id: 'q1', content: 'A very long queued message that needs a tooltip' }] });

        // The Tooltip wrapper (.tooltip-container) contains the item and a
        // role="tooltip" box carrying the full text.
        const item = screen.getByTestId('queued-item-q1');
        const container = item.closest('.tooltip-container') as HTMLElement;
        const tooltip = within(container).getByRole('tooltip');
        expect(tooltip).toHaveTextContent('A very long queued message that needs a tooltip');
    });
});
