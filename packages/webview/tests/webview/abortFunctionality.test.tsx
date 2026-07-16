import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderChatApp, screen, fireEvent, sendCommand } from './test-utils';
import { StreamingFixtures } from '../fixtures/streamingFixtures';

/** The abort button is always in the DOM but toggled via style.display */
function expectAbortVisible(visible: boolean) {
    const btn = screen.getByTestId('abort-btn') as HTMLElement;
    expect(btn).toBeInTheDocument();
    const display = btn.style.display;
    if (visible) {
        expect(display).not.toBe('none');
    } else {
        expect(display).toBe('none');
    }
}

describe('Abort Functionality', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should show abort button during streaming', () => {
        renderChatApp();

        // Initially abort button should be hidden
        expectAbortVisible(false);

        // Start streaming
        sendCommand('startStreaming');

        // Abort button should now be visible
        expectAbortVisible(true);
    });

    it('should hide abort button when not streaming', () => {
        renderChatApp();

        // Start streaming to show abort button
        sendCommand('startStreaming');
        expectAbortVisible(true);

        // Simulate streaming completion by updating with final messages
        sendCommand('updateMessages', {
            messages: [{
                id: "msg_1",
                role: "assistant",
                timestamp: "2024-01-01T00:00:00.000Z",
                blocks: [{ type: "text", content: "Completed message" }]
            }]
        });

        // End streaming (simulates agent.sendMessage() completion)
        sendCommand('endStreaming');

        // Abort button should be hidden again
        expectAbortVisible(false);
    });

    it('should handle abort button click', () => {
        const { vscode } = renderChatApp();

        // Start streaming
        sendCommand('startStreaming');
        expectAbortVisible(true);

        // Add some streaming content
        sendCommand('updateMessages', {
            messages: [{
                id: "msg_streaming_1",
                role: "assistant",
                timestamp: "2024-01-01T00:00:00.000Z",
                blocks: [{ type: "text", content: "This is partial content that will be aborted..." }]
            }]
        });

        // Click abort button
        fireEvent.click(screen.getByTestId('abort-btn'));

        // Verify abort message was sent to extension
        const sentMessages = vscode.postMessage.mock.calls.map(c => c[0]);
        const abortMessage = sentMessages.find(msg => msg.command === 'abortMessage');
        expect(abortMessage).toBeDefined();
    });

    it('should preserve partial content when aborted', () => {
        renderChatApp();

        // Start streaming
        sendCommand('startStreaming');

        // Add some content
        const partialContent = 'This message was interrupted';
        sendCommand('updateMessages', {
            messages: [{
                id: "msg_partial_1",
                role: "assistant",
                timestamp: "2024-01-01T00:00:00.000Z",
                blocks: [{ type: "text", content: partialContent }]
            }]
        });

        // Simulate abort with partial content preservation
        const abortedMessage = {
            id: `msg_abort_${Date.now()}`,
            role: 'assistant' as const,
            timestamp: '2024-01-01T00:00:00.000Z',
            blocks: [{ type: 'error' as const, content: partialContent }]
        };
        sendCommand('updateMessages', { messages: [abortedMessage] });

        // End streaming (simulates agent completing after abort)
        sendCommand('endStreaming');

        // Verify the partial content is still visible
        const messages = document.querySelectorAll('.message');
        const lastMessage = messages[messages.length - 1] as HTMLElement;
        expect(lastMessage).toHaveTextContent(partialContent);

        // Abort button should be hidden after abort
        expectAbortVisible(false);
    });

    it('should allow new messages after abort', () => {
        renderChatApp();

        // Start and abort streaming
        sendCommand('startStreaming');
        sendCommand('updateMessages', {
            messages: [{
                id: "msg_partial_2",
                role: "assistant",
                timestamp: "2024-01-01T00:00:00.000Z",
                blocks: [{ type: "text", content: "Partial content" }]
            }]
        });

        // Simulate abort
        const abortedMessage = {
            id: `msg_abort_${Date.now()}`,
            role: 'assistant' as const,
            timestamp: '2024-01-01T00:00:00.000Z',
            blocks: [{ type: 'error' as const, content: 'Partial content' }]
        };
        sendCommand('updateMessages', { messages: [abortedMessage] });

        // End streaming (simulates agent completing after abort)
        sendCommand('endStreaming');

        // Verify UI is ready for new input
        expectAbortVisible(false);

        // Verify send button is present (disabled when input is empty, which is correct)
        const sendBtn = screen.getByTestId('send-btn');
        expect(sendBtn).toBeInTheDocument();

        // Verify message input is present and editable
        const messageInput = screen.getByTestId('message-input');
        expect(messageInput).toBeInTheDocument();
        expect(messageInput.getAttribute('contenteditable')).toBe('true');
    });

    it('should handle abort with streaming scenario', () => {
        renderChatApp();

        // Use the aborted streaming scenario
        const scenario = StreamingFixtures.ABORTED_STREAMING;

        // Start streaming
        sendCommand('startStreaming');
        expectAbortVisible(true);

        // Stream up to abort point
        let accumulated = '';
        for (let i = 0; i < (scenario.abortAtChunk || 3); i++) {
            accumulated += scenario.chunks[i];
            sendCommand('updateMessages', {
                messages: [{
                    id: "msg_streaming_scenario",
                    role: "assistant",
                    timestamp: "2024-01-01T00:00:00.000Z",
                    blocks: [{ type: "text", content: accumulated }]
                }]
            });
        }

        // Verify content before abort
        const messages = document.querySelectorAll('.message');
        const lastMessage = messages[messages.length - 1] as HTMLElement;
        expect(lastMessage).toHaveTextContent(/I'm going to write a very/);

        // Simulate abort
        const abortedMessage = {
            id: `msg_abort_final`,
            role: 'assistant' as const,
            timestamp: '2024-01-01T00:00:00.000Z',
            blocks: [{ type: 'error' as const, content: scenario.finalContent }]
        };
        sendCommand('updateMessages', { messages: [abortedMessage] });

        // End streaming (simulates agent completing after abort)
        sendCommand('endStreaming');

        // Verify abort preserved the expected content
        const messagesAfter = document.querySelectorAll('.message');
        const lastMessageAfter = messagesAfter[messagesAfter.length - 1] as HTMLElement;
        expect(lastMessageAfter).toHaveTextContent(scenario.finalContent);
        expectAbortVisible(false);
    });
});
