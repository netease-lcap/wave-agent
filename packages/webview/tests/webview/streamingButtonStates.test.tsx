import { describe, it, expect, beforeEach } from 'vitest';
import { renderChatApp, screen, fireEvent, sendCommand } from './test-utils';

/**
 * Helper: get all message elements from the messages container
 */
function getMessages(): HTMLElement[] {
    const container = screen.getByTestId('messages-container');
    return Array.from(container.querySelectorAll('.message'));
}

describe('Streaming Button States', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should disable header buttons during streaming', () => {
        renderChatApp();

        // Verify initial state - all buttons should be enabled
        const clearChatBtn = screen.getByTestId('clear-chat-btn');
        expect(clearChatBtn).not.toBeDisabled();
        expect(screen.getByTestId('send-btn')).toBeInTheDocument();
        expect(screen.getByTestId('abort-btn')).not.toBeVisible();

        // Start streaming
        sendCommand('startStreaming');

        // Verify buttons are disabled during streaming
        expect(clearChatBtn).toBeDisabled();
        expect(screen.getByTestId('abort-btn')).toBeVisible();

        // Verify input is enabled during streaming (allows multiple messages)
        const input = screen.getByTestId('message-input');
        expect(input).not.toHaveAttribute('contenteditable', 'false');
    });

    it('should re-enable header buttons after streaming ends', () => {
        renderChatApp();

        // Start streaming
        sendCommand('startStreaming');
        const clearChatBtn = screen.getByTestId('clear-chat-btn');
        expect(clearChatBtn).toBeDisabled();

        // End streaming by updating with final messages
        sendCommand('updateMessages', {
            messages: [{
                id: 'msg_streaming_end_1',
                role: 'assistant',
                timestamp: '2024-01-01T00:00:00.000Z',
                blocks: [{ type: 'text', content: 'Streaming completed' }]
            }]
        });

        // End streaming (simulates agent.sendMessage() completion)
        sendCommand('endStreaming');

        // Verify buttons are re-enabled
        expect(clearChatBtn).not.toBeDisabled();
        expect(screen.getByTestId('abort-btn')).not.toBeVisible();

        // Empty and enabled
        const input = screen.getByTestId('message-input');
        expect(input.textContent).toBe('');
    });

    it('should prevent clear chat during streaming', () => {
        const { vscode } = renderChatApp();

        // Add some messages first
        sendCommand('updateMessages', {
            messages: [{
                id: 'msg_streaming_prevent_1',
                role: 'assistant',
                timestamp: '2024-01-01T00:00:00.000Z',
                blocks: [{ type: 'text', content: 'This is a test message' }]
            }]
        });
        expect(getMessages()).toHaveLength(2); // Welcome + test message

        // Start streaming
        sendCommand('startStreaming');

        sendCommand('updateMessages', {
            messages: [{
                id: 'msg_streaming_prevent_1',
                role: 'assistant',
                timestamp: '2024-01-01T00:00:00.000Z',
                blocks: [{ type: 'text', content: 'This is a test message' }]
            }, {
                id: 'msg_streaming_prevent_2',
                role: 'assistant',
                timestamp: '2024-01-01T00:00:00.000Z',
                blocks: [{ type: 'text', content: "I'm currently streaming..." }]
            }]
        });
        expect(screen.getByTestId('abort-btn')).toBeVisible();

        // Clear message log to track new commands
        vscode.postMessage.mockClear();

        // Try to click clear chat (should be disabled)
        const clearChatBtn = screen.getByTestId('clear-chat-btn');
        expect(clearChatBtn).toBeDisabled();

        // Verify that clicking disabled button doesn't send command
        const sentMessages = vscode.postMessage.mock.calls.map(c => c[0]);
        expect(sentMessages.filter((msg: Record<string, unknown>) => msg.command === 'clearChat')).toHaveLength(0);

        // Messages should still be there
        expect(getMessages()).toHaveLength(3); // Welcome + test message + streaming message
    });

    it('should handle abort and restore button states', () => {
        renderChatApp();

        // Start streaming
        sendCommand('startStreaming');
        sendCommand('updateMessages', {
            messages: [{
                id: 'msg_streaming_abort_1',
                role: 'assistant',
                timestamp: '2024-01-01T00:00:00.000Z',
                blocks: [{ type: 'text', content: 'This will be aborted...' }]
            }]
        });

        // Verify buttons are in streaming state
        const clearChatBtn = screen.getByTestId('clear-chat-btn');
        expect(clearChatBtn).toBeDisabled();
        expect(screen.getByTestId('abort-btn')).toBeVisible();

        // Abort the message
        fireEvent.click(screen.getByTestId('abort-btn'));

        // End streaming (simulates agent completing after abort)
        sendCommand('endStreaming');

        // Verify buttons are restored after abort
        expect(clearChatBtn).not.toBeDisabled();
        expect(screen.getByTestId('abort-btn')).not.toBeVisible();

        // Empty and enabled
        const input = screen.getByTestId('message-input');
        expect(input.textContent).toBe('');
    });
});
