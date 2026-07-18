import { describe, it, expect, beforeEach } from 'vitest';
import { renderChatApp, screen, sendCommand } from './test-utils';
import { StreamingFixtures } from '../fixtures/streamingFixtures';

/**
 * Helper: get all message elements from the messages container
 */
function getMessages(): HTMLElement[] {
    const container = screen.getByTestId('messages-container');
    return Array.from(container.querySelectorAll('.message'));
}

/**
 * Helper: get the last message element
 */
function getLastMessage(): HTMLElement {
    const msgs = getMessages();
    return msgs[msgs.length - 1];
}

describe('Streaming Messages', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should display streaming message and updates', () => {
        renderChatApp();

        // Start streaming
        sendCommand('startStreaming');

        // Verify streaming indicator (abort button visible)
        const abortBtn = screen.getByTestId('abort-btn');
        expect(abortBtn).toBeVisible();

        // Simulate streaming updates using updateMessages
        const scenario = StreamingFixtures.BASIC_STREAMING;
        let accumulated = '';

        for (const chunk of scenario.chunks) {
            accumulated += chunk;
            // Send progressive updates via updateMessages (simulating real agent-sdk behavior)
            sendCommand('updateMessages', {
                messages: [{
                    id: 'msg_streaming_basic',
                    role: 'assistant',
                    timestamp: '2024-01-01T00:00:00.000Z',
                    blocks: [{ type: 'text', content: accumulated }]
                }]
            });

            // Verify content is updated
            expect(getLastMessage()).toHaveTextContent(accumulated);
        }

        // End streaming
        sendCommand('endStreaming');

        // Verify final accumulated content
        expect(getLastMessage()).toHaveTextContent(scenario.finalContent);
    });

    it('should handle longer streaming content', () => {
        renderChatApp();

        // Start streaming
        sendCommand('startStreaming');
        expect(screen.getByTestId('abort-btn')).toBeVisible();

        // Use code explanation scenario
        const scenario = StreamingFixtures.CODE_EXPLANATION;
        let accumulated = '';

        // Stream content with delays
        for (let i = 0; i < scenario.chunks.length; i++) {
            accumulated += scenario.chunks[i];
            sendCommand('updateMessages', {
                messages: [{
                    id: 'msg_streaming_long',
                    role: 'assistant',
                    timestamp: '2024-01-01T00:00:00.000Z',
                    blocks: [{ type: 'text', content: accumulated }]
                }]
            });

            // Verify progressive content updates
            expect(getLastMessage()).toHaveTextContent(scenario.chunks[0]); // Should contain first chunk
        }

        // End streaming
        sendCommand('endStreaming');

        // Verify final content includes all parts (markdown is rendered as HTML)
        expect(getLastMessage()).toHaveTextContent('Looking at your code');
        expect(getLastMessage()).toHaveTextContent('Add error handling');
        expect(getLastMessage()).toHaveTextContent('Return meaningful errors');
    });

    it('should handle empty streaming updates gracefully', () => {
        renderChatApp();

        // Start streaming
        sendCommand('startStreaming');
        expect(screen.getByTestId('abort-btn')).toBeVisible();

        // Send empty update
        sendCommand('updateMessages', {
            messages: [{
                id: 'msg_streaming_empty',
                role: 'assistant',
                timestamp: '2024-01-01T00:00:00.000Z',
                blocks: [{ type: 'text', content: '' }]
            }]
        });

        // Empty content should not render .message-content div
        const lastMsg = getLastMessage();
        expect(lastMsg.querySelector('.message-content')).toBeNull();

        // Send actual content
        sendCommand('updateMessages', {
            messages: [{
                id: 'msg_streaming_empty',
                role: 'assistant',
                timestamp: '2024-01-01T00:00:00.000Z',
                blocks: [{ type: 'text', content: 'Hello world' }]
            }]
        });
        expect(getLastMessage()).toHaveTextContent('Hello world');

        // Send empty again
        sendCommand('updateMessages', {
            messages: [{
                id: 'msg_streaming_empty',
                role: 'assistant',
                timestamp: '2024-01-01T00:00:00.000Z',
                blocks: [{ type: 'text', content: '' }]
            }]
        });
        // Empty content should not render .message-content div
        const lastMsgAgain = getLastMessage();
        expect(lastMsgAgain.querySelector('.message-content')).toBeNull();

        // End streaming
        sendCommand('endStreaming');
    });

    it('should differentiate streaming from completed messages', () => {
        renderChatApp();

        // Add a completed message first
        sendCommand('updateMessages', {
            messages: [{
                id: 'msg_completed_1',
                role: 'assistant',
                timestamp: '2024-01-01T00:00:00.000Z',
                blocks: [{ type: 'text', content: 'This is a completed message' }]
            }]
        });

        expect(getMessages()).toHaveLength(2); // Welcome (hardcoded) + completed message
        // No abort button visible (not streaming)
        expect(screen.getByTestId('abort-btn')).not.toBeVisible();

        // Now start streaming
        sendCommand('startStreaming');

        // Should still have 2 messages (streaming doesn't add a message until content arrives)
        expect(getMessages()).toHaveLength(2); // Welcome + completed (no streaming message yet)
        expect(screen.getByTestId('abort-btn')).toBeVisible();

        // Update streaming content by sending new message set
        sendCommand('updateMessages', {
            messages: [{
                id: 'msg_completed_1',
                role: 'assistant',
                timestamp: '2024-01-01T00:00:00.000Z',
                blocks: [{ type: 'text', content: 'This is a completed message' }]
            }, {
                id: 'msg_streaming_1',
                role: 'assistant',
                timestamp: '2024-01-01T00:00:00.000Z',
                blocks: [{ type: 'text', content: 'This is streaming content' }]
            }]
        });

        // Verify we now have all three types
        expect(getMessages()).toHaveLength(3); // welcome + completed + streaming
        expect(screen.getByTestId('abort-btn')).toBeVisible();
        expect(getMessages()[1]).toHaveTextContent('This is a completed message'); // Completed message (index 1, after welcome)
        expect(getLastMessage()).toHaveTextContent('This is streaming content'); // Streaming message

        // End streaming
        sendCommand('endStreaming');
    });
});
