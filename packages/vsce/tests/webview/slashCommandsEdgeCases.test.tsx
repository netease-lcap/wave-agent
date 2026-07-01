import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderChatApp, screen, waitFor, fireEvent, act, sendCommand } from './test-utils';

function typeInInput(text: string) {
    const input = screen.getByTestId('message-input');
    const existing = input.textContent || '';
    const fullText = existing + text;
    input.textContent = fullText;

    // Set selection at end of the text node
    const range = document.createRange();
    if (input.firstChild && input.firstChild.nodeType === Node.TEXT_NODE) {
        const textNode = input.firstChild;
        range.setStart(textNode, textNode.textContent!.length);
        range.collapse(true);
    } else {
        range.selectNodeContents(input);
        range.collapse(false);
    }
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);

    fireEvent.input(input, { data: text, inputType: 'insertText' });
}

describe('Slash Commands Edge Cases', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers({ shouldAdvanceTime: true });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('should use regular spaces after slash command and file mentions when sending', async () => {
        const { vscode } = renderChatApp();

        const input = screen.getByTestId('message-input');
        input.focus();

        // Simulate selecting a slash command followed by a file mention tag.
        const el = input as HTMLDivElement;
        el.innerHTML = '';

        const textNode = document.createTextNode('/speckit ');
        el.appendChild(textNode);

        const tagSpan = document.createElement('span');
        tagSpan.className = 'context-tag-container';
        tagSpan.contentEditable = 'false';
        tagSpan.setAttribute('data-path', 'src/test.md');
        tagSpan.setAttribute('data-name', 'test.md');
        tagSpan.setAttribute('data-is-image', 'false');
        tagSpan.innerText = '[@file:src/test.md]';
        el.appendChild(tagSpan);

        // Set cursor after the tag
        const range = document.createRange();
        range.setStartAfter(tagSpan);
        range.collapse(true);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);

        fireEvent.input(el, { data: '/speckit ', inputType: 'insertText' });

        // Verify the raw contenteditable has a regular space (no nbsp)
        const rawContent = input.textContent || '';
        expect(rawContent).toContain('/speckit ');
        expect(rawContent).not.toContain('\u00A0');

        // Clear any previously sent messages
        vscode.postMessage.mockClear();

        // Click send
        const sendButton = screen.getByTestId('send-btn');
        await act(async () => {
            fireEvent.click(sendButton);
        });

        // Verify the sendMessage payload is correctly formatted
        const messages = vscode.postMessage.mock.calls.map(c => c[0]);
        const sendMessage = messages.find((m) => m.command === 'sendMessage');
        expect(sendMessage).toBeDefined();
        expect(sendMessage.text).toContain('/speckit ');
        expect(sendMessage.text).toContain('[@file:src/test.md]');
    });

    it('should only trigger slash commands at valid positions', async () => {
        const { vscode } = renderChatApp();
        vscode.postMessage.mockClear();

        const input = screen.getByTestId('message-input');
        input.focus();

        // 1. Type "word/" (no space before /, so should NOT trigger popup)
        typeInInput('word/');

        // Advance fake time past debounce
        await vi.advanceTimersByTimeAsync(300);

        // 2. Verify popup is NOT visible
        expect(screen.queryByTestId('slash-commands-popup')).not.toBeInTheDocument();

        // Clear to verify no request was sent
        const hadRequest = vscode.postMessage.mock.calls.some(
            (c) => c[0]?.command === 'requestSlashCommands'
        );
        expect(hadRequest).toBe(false);

        // 3. Type a space and then '/'
        typeInInput(' /');

        // Advance fake time past debounce
        await vi.advanceTimersByTimeAsync(300);

        // 4. Simulate response
        sendCommand('slashCommandsResponse', {
            commands: [
                { id: 'help', name: 'help', description: 'Show help' }
            ]
        });

        // 5. Verify popup IS visible
        await waitFor(() => {
            expect(screen.getByTestId('slash-commands-popup')).toBeInTheDocument();
        });
    });

    it('should allow navigating and selecting commands with keyboard', async () => {
        const { vscode } = renderChatApp();

        const input = screen.getByTestId('message-input');
        input.focus();

        typeInInput('/');

        await waitFor(() => {
            expect(vscode.postMessage).toHaveBeenCalledWith(
                expect.objectContaining({ command: 'requestSlashCommands' })
            );
        }, { timeout: 3000 });

        // Simulate response with multiple commands
        sendCommand('slashCommandsResponse', {
            commands: [
                { id: 'cmd1', name: 'cmd1', description: 'Command 1' },
                { id: 'cmd2', name: 'cmd2', description: 'Command 2' }
            ]
        });

        await waitFor(() => {
            expect(screen.getByTestId('slash-commands-popup')).toBeInTheDocument();
        });

        const popup = screen.getByTestId('slash-commands-popup');

        // Verify first command is selected by default
        const items = popup.querySelectorAll('.slash-command-item');
        expect(items[0]).toHaveClass('selected');

        // Press ArrowDown to select second command
        await act(async () => {
            fireEvent.keyDown(input, { key: 'ArrowDown' });
        });

        expect(items[1]).toHaveClass('selected');
        expect(items[0]).not.toHaveClass('selected');

        // Press Enter to select
        await act(async () => {
            fireEvent.keyDown(input, { key: 'Enter' });
        });

        // Verify content
        await waitFor(() => {
            expect(input.textContent?.trim()).toBe('/cmd2');
        });
    });

    it('should close popup on Escape', async () => {
        const { vscode } = renderChatApp();

        const input = screen.getByTestId('message-input');
        input.focus();

        typeInInput('/');

        await waitFor(() => {
            expect(vscode.postMessage).toHaveBeenCalledWith(
                expect.objectContaining({ command: 'requestSlashCommands' })
            );
        }, { timeout: 3000 });

        sendCommand('slashCommandsResponse', {
            commands: [{ id: 'help', name: 'help', description: 'Show help' }]
        });

        await waitFor(() => {
            expect(screen.getByTestId('slash-commands-popup')).toBeInTheDocument();
        });

        // Press Escape
        await act(async () => {
            fireEvent.keyDown(input, { key: 'Escape' });
        });

        // Verify popup is closed
        await waitFor(() => {
            expect(screen.queryByTestId('slash-commands-popup')).not.toBeInTheDocument();
        });

        // Verify '/' is still in input
        expect(input.textContent?.trim()).toBe('/');
    });

    it('should handle multiple slash commands in one message', async () => {
        const { vscode } = renderChatApp();

        const input = screen.getByTestId('message-input');
        input.focus();

        // First command
        typeInInput('/');

        await waitFor(() => {
            expect(vscode.postMessage).toHaveBeenCalledWith(
                expect.objectContaining({ command: 'requestSlashCommands' })
            );
        }, { timeout: 3000 });

        sendCommand('slashCommandsResponse', {
            commands: [{ id: 'cmd1', name: 'cmd1', description: 'Command 1' }]
        });
        await waitFor(() => {
            expect(screen.getByTestId('slash-commands-popup')).toBeInTheDocument();
        });
        await act(async () => {
            fireEvent.keyDown(input, { key: 'Enter' });
        });
        await waitFor(() => {
            expect(screen.queryByTestId('slash-commands-popup')).not.toBeInTheDocument();
        });

        // Second command - append '/' to existing content
        const existing = input.textContent || '';
        input.textContent = existing + '/';

        // Set selection at end of text node
        const range = document.createRange();
        if (input.firstChild && input.firstChild.nodeType === Node.TEXT_NODE) {
            const textNode = input.firstChild;
            range.setStart(textNode, textNode.textContent!.length);
            range.collapse(true);
        } else {
            range.selectNodeContents(input);
            range.collapse(false);
        }
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);

        fireEvent.input(input, { data: '/', inputType: 'insertText' });

        await waitFor(() => {
            expect(vscode.postMessage).toHaveBeenCalledWith(
                expect.objectContaining({ command: 'requestSlashCommands' })
            );
        }, { timeout: 3000 });

        sendCommand('slashCommandsResponse', {
            commands: [{ id: 'cmd2', name: 'cmd2', description: 'Command 2' }]
        });
        await waitFor(() => {
            expect(screen.getByTestId('slash-commands-popup')).toBeInTheDocument();
        });
        await act(async () => {
            fireEvent.keyDown(input, { key: 'Enter' });
        });
        await waitFor(() => {
            expect(screen.queryByTestId('slash-commands-popup')).not.toBeInTheDocument();
        });

        // Verify content
        await waitFor(() => {
            const content = input.textContent?.replace(/\u00A0/g, ' ').trim();
            expect(content).toBe('/cmd1 /cmd2');
        });
    });
});
