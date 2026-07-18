import { describe, it, expect } from 'vitest';
import { renderChatApp, screen, act } from './test-utils';

describe('Bang Input Focus', () => {
    it('input should regain focus after bang command completes', async () => {
        renderChatApp();

        const input = screen.getByTestId('message-input');
        input.focus();
        expect(document.activeElement).toBe(input);

        // Simulate bang command starting (isCommandRunning = true)
        await act(async () => {
            window.dispatchEvent(new MessageEvent('message', {
                data: { command: 'updateCommandRunning', running: true }
            }));
        });

        // Input should remain enabled when command is running
        expect(input).not.toBeDisabled();

        // Simulate bang command completing (isCommandRunning = false)
        await act(async () => {
            window.dispatchEvent(new MessageEvent('message', {
                data: { command: 'updateCommandRunning', running: false }
            }));
        });

        // Input should be enabled again
        expect(input).not.toBeDisabled();

        // Input should have regained focus
        expect(document.activeElement).toBe(input);
    });

    it('input should remain focused when sending normal message', async () => {
        renderChatApp();

        const input = screen.getByTestId('message-input');
        input.focus();
        expect(document.activeElement).toBe(input);

        // Simulate streaming starting (normal message)
        await act(async () => {
            window.dispatchEvent(new MessageEvent('message', {
                data: { command: 'startStreaming' }
            }));
        });

        // Input should still be enabled (not disabled by streaming)
        expect(input).not.toBeDisabled();
    });
});
