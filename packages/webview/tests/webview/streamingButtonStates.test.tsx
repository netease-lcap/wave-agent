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

    it('should swap send/abort buttons during streaming while new session stays enabled', () => {
        renderChatApp();

        // Verify initial state - all buttons should be enabled
        const newSessionBtn = screen.getByTestId('new-session-btn');
        expect(newSessionBtn).not.toBeDisabled();
        expect(screen.getByTestId('send-btn')).toBeInTheDocument();
        expect(screen.queryByTestId('abort-btn')).not.toBeInTheDocument();

        // Start streaming
        sendCommand('startStreaming');

        // Send swaps to abort during streaming; new session stays enabled (opens a new tab)
        expect(newSessionBtn).not.toBeDisabled();
        expect(screen.getByTestId('abort-btn')).toBeInTheDocument();
        expect(screen.queryByTestId('send-btn')).not.toBeInTheDocument();

        // Verify input is enabled during streaming (allows multiple messages)
        const input = screen.getByTestId('message-input');
        expect(input).not.toHaveAttribute('contenteditable', 'false');
    });

    it('should restore send button after streaming ends', () => {
        renderChatApp();

        // Start streaming
        sendCommand('startStreaming');
        const newSessionBtn = screen.getByTestId('new-session-btn');
        expect(newSessionBtn).not.toBeDisabled();

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

        // Verify buttons are restored
        expect(newSessionBtn).not.toBeDisabled();
        expect(screen.queryByTestId('abort-btn')).not.toBeInTheDocument();
        expect(screen.getByTestId('send-btn')).toBeInTheDocument();

        // Empty and enabled
        const input = screen.getByTestId('message-input');
        expect(input.textContent).toBe('');
    });

    it('should request a new chat tab during streaming without touching current messages', () => {
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
        expect(getMessages()).toHaveLength(1); // test message

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
        expect(screen.getByTestId('abort-btn')).toBeInTheDocument();

        // Clear message log to track new commands
        vscode.postMessage.mockClear();

        // New session button stays enabled during streaming; clicking requests a new tab
        const newSessionBtn = screen.getByTestId('new-session-btn');
        expect(newSessionBtn).not.toBeDisabled();
        fireEvent.click(newSessionBtn);

        const sentMessages = vscode.postMessage.mock.calls.map(c => c[0]);
        expect(sentMessages.filter((msg: Record<string, unknown>) => msg.command === 'newChatTab')).toHaveLength(1);
        expect(sentMessages.filter((msg: Record<string, unknown>) => msg.command === 'clearChat')).toHaveLength(0);

        // Messages should still be there
        expect(getMessages()).toHaveLength(2); // test message + streaming message
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
        const newSessionBtn = screen.getByTestId('new-session-btn');
        expect(newSessionBtn).not.toBeDisabled();
        expect(screen.getByTestId('abort-btn')).toBeInTheDocument();

        // Abort the message
        fireEvent.click(screen.getByTestId('abort-btn'));

        // End streaming (simulates agent completing after abort)
        sendCommand('endStreaming');

        // Verify buttons are restored after abort
        expect(newSessionBtn).not.toBeDisabled();
        expect(screen.queryByTestId('abort-btn')).not.toBeInTheDocument();

        // Empty and enabled
        const input = screen.getByTestId('message-input');
        expect(input.textContent).toBe('');
    });
});
