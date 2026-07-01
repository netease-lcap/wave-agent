import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderChatApp, screen, waitFor, fireEvent, act, sendCommand } from './test-utils';

/**
 * Helper: set contenteditable text, set up selection inside a text node at end,
 * and fire input event.
 *
 * jsdom's Selection API works, but handleSlashCommandSelect/handleFileSelect
 * check `textNode.nodeType === Node.TEXT_NODE` — if selection is on the div
 * itself (nodeType=1), they skip. So we must ensure selection is inside a
 * Text node.
 */
function typeInInput(text: string) {
    const input = screen.getByTestId('message-input');
    const existing = input.textContent || '';
    const fullText = existing + text;
    input.textContent = fullText;

    // Set selection at end of the text node (not on the div)
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

describe('Slash Commands', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should insert slash command with a space when selected via Enter', async () => {
        const { vscode } = renderChatApp();

        const input = screen.getByTestId('message-input');
        input.focus();

        // Type '/' to trigger slash commands
        typeInInput('/');

        // Verify requestSlashCommands was sent (debounced 150ms)
        await waitFor(() => {
            expect(vscode.postMessage).toHaveBeenCalledWith(
                expect.objectContaining({ command: 'requestSlashCommands' })
            );
        }, { timeout: 3000 });

        // Simulate response from extension
        sendCommand('slashCommandsResponse', {
            commands: [
                { id: 'init', name: 'init', description: 'Initialize repository' },
                { id: 'help', name: 'help', description: 'Show help' }
            ]
        });

        // Verify popup is visible
        await waitFor(() => {
            expect(screen.getByTestId('slash-commands-popup')).toBeInTheDocument();
        });

        // Press Enter to select the first command (init)
        await act(async () => {
            fireEvent.keyDown(input, { key: 'Enter' });
        });

        // Verify popup is closed
        await waitFor(() => {
            expect(screen.queryByTestId('slash-commands-popup')).not.toBeInTheDocument();
        });

        // Verify input content (should be "/init" with trailing space in textContent)
        await waitFor(() => {
            expect(input.textContent?.trim()).toBe('/init');
        });
        expect(input.textContent).toBe('/init ');
    });

    it('should insert slash command correctly after existing text', async () => {
        const { vscode } = renderChatApp();

        const input = screen.getByTestId('message-input');
        input.focus();

        // Type "hello " then "/"
        typeInInput('hello ');
        typeInInput('/');

        // Wait for requestSlashCommands
        await waitFor(() => {
            expect(vscode.postMessage).toHaveBeenCalledWith(
                expect.objectContaining({ command: 'requestSlashCommands' })
            );
        }, { timeout: 3000 });

        // Simulate response
        sendCommand('slashCommandsResponse', {
            commands: [
                { id: 'init', name: 'init', description: 'Initialize repository' }
            ]
        });

        // Wait for popup
        await waitFor(() => {
            expect(screen.getByTestId('slash-commands-popup')).toBeInTheDocument();
        });

        // Select command
        await act(async () => {
            fireEvent.keyDown(input, { key: 'Enter' });
        });

        // Verify content
        await waitFor(() => {
            expect(input.textContent?.trim()).toBe('hello /init');
        });
        expect(input.textContent).toBe('hello /init ');
    });

    it('should insert slash command with Tab key', async () => {
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
            commands: [
                { id: 'init', name: 'init', description: 'Initialize repository' },
                { id: 'help', name: 'help', description: 'Show help' }
            ]
        });

        await waitFor(() => {
            expect(screen.getByTestId('slash-commands-popup')).toBeInTheDocument();
        });

        // Press Tab to select the first command
        await act(async () => {
            fireEvent.keyDown(input, { key: 'Tab' });
        });

        // Verify popup is closed
        await waitFor(() => {
            expect(screen.queryByTestId('slash-commands-popup')).not.toBeInTheDocument();
        });

        await waitFor(() => {
            expect(input.textContent?.trim()).toBe('/init');
        });
        expect(input.textContent).toBe('/init ');
    });

    it('should insert slash command when clicked with mouse', async () => {
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
            commands: [
                { id: 'init', name: 'init', description: 'Initialize repository' },
                { id: 'help', name: 'help', description: 'Show help' }
            ]
        });

        await waitFor(() => {
            expect(screen.getByTestId('slash-commands-popup')).toBeInTheDocument();
        });

        // Click the first command item with mouse
        const cmdItem = screen.getByTestId('slash-command-init');
        await act(async () => {
            fireEvent.mouseDown(cmdItem);
        });

        // Verify popup is closed
        await waitFor(() => {
            expect(screen.queryByTestId('slash-commands-popup')).not.toBeInTheDocument();
        });

        await waitFor(() => {
            expect(input.textContent?.trim()).toBe('/init');
        });
        expect(input.textContent).toBe('/init ');
    });

    it('should filter slash commands as user types', async () => {
        const { vscode } = renderChatApp();

        const input = screen.getByTestId('message-input');
        input.focus();

        // Type '/h'
        typeInInput('/h');

        await waitFor(() => {
            expect(vscode.postMessage).toHaveBeenCalledWith(
                expect.objectContaining({ command: 'requestSlashCommands' })
            );
        }, { timeout: 3000 });

        // Simulate response with filtered commands
        sendCommand('slashCommandsResponse', {
            commands: [
                { id: 'help', name: 'help', description: 'Show help' }
            ]
        });

        await waitFor(() => {
            expect(screen.getByTestId('slash-commands-popup')).toBeInTheDocument();
        });

        const popup = screen.getByTestId('slash-commands-popup');
        expect(popup).toHaveTextContent('/help');
        expect(popup).not.toHaveTextContent('/init');
    });

});
