import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderChatApp, screen, sendCommand } from './test-utils';

/**
 * Regression: the streaming cursor (blinking ▋) used to be a `::after` on the
 * last `.message` element, picked via `streamingMessageIndex = messages.length - 1`.
 * When the backend appended a trailing `isMeta` user message (task-reminder /
 * goal reminder / length-resume prompt) before the first content chunk, that
 * index pointed at a hidden meta message — the cursor vanished while the abort
 * button (driven directly by isStreaming) stayed.
 *
 * The cursor is now a `::after` on `.messages-container` itself, toggled by the
 * single `isStreaming` flag. It can never diverge from the abort button, shows
 * even before the first assistant chunk lands, and is immune to trailing meta
 * messages.
 */
describe('Streaming cursor on the messages container', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('shows the cursor (container.streaming) while streaming, even with a trailing meta message', () => {
        renderChatApp();

        // Seed a visible user message so the MessageList (not the welcome page) renders.
        sendCommand('updateMessages', {
            messages: [{
                id: 'msg-user-1',
                role: 'user',
                timestamp: '2024-01-01T00:00:00.000Z',
                blocks: [{ type: 'text', content: 'Hello' }]
            }]
        });

        // Backend flips loading → webview isStreaming = true, BEFORE any assistant
        // chunk has arrived. The cursor must already be visible at the list bottom.
        sendCommand('startStreaming');

        const container = screen.getByTestId('messages-container');
        expect(container.classList.contains('streaming')).toBe(true);
        // Abort button is driven by the same isStreaming flag.
        expect(screen.getByTestId('abort-btn')).toBeInTheDocument();

        // Agent injects a meta user message (task reminder) AFTER the assistant
        // turn message but before content streams. The cursor must stay.
        sendCommand('updateMessages', {
            messages: [
                {
                    id: 'msg-user-1',
                    role: 'user',
                    timestamp: '2024-01-01T00:00:00.000Z',
                    blocks: [{ type: 'text', content: 'Hello' }]
                },
                {
                    id: 'msg-assistant-1',
                    role: 'assistant',
                    timestamp: '2024-01-01T00:00:00.000Z',
                    blocks: [{ type: 'text', content: 'Let me think…' }]
                },
                {
                    id: 'msg-meta-1',
                    role: 'user',
                    isMeta: true,
                    timestamp: '2024-01-01T00:00:00.000Z',
                    blocks: [{ type: 'text', content: '<!-- task-reminder -->' }]
                }
            ]
        });

        // Meta message stays hidden; cursor + abort button remain.
        expect(screen.queryByText('<!-- task-reminder -->')).not.toBeInTheDocument();
        expect(screen.getByTestId('messages-container').classList.contains('streaming')).toBe(true);
        expect(screen.getByTestId('abort-btn')).toBeInTheDocument();

        // No individual message carries a `streaming` class anymore.
        const msgs = screen.getByTestId('messages-container').querySelectorAll('.message');
        msgs.forEach(m => expect(m.classList.contains('streaming')).toBe(false));

        // End streaming → cursor disappears in lockstep with the abort button.
        sendCommand('endStreaming');
        expect(screen.getByTestId('messages-container').classList.contains('streaming')).toBe(false);
        expect(screen.queryByTestId('abort-btn')).not.toBeInTheDocument();
    });
});
