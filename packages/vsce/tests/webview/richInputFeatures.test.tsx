import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderChatApp, screen, fireEvent, act } from './test-utils';

/**
 * Helper: append text to contenteditable input without destroying existing child nodes.
 * Sets selection inside the new text node so handlers that check nodeType work.
 */
function typeInInput(text: string) {
    const input = screen.getByTestId('message-input');
    const textNode = document.createTextNode(text);
    input.appendChild(textNode);

    // Set selection inside the new text node
    const range = document.createRange();
    range.setStart(textNode, text.length);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);

    fireEvent.input(input, { inputType: 'insertText' });
}

describe('Rich Input Features', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.useFakeTimers({ shouldAdvanceTime: true });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('should handle mixed text and multiple context tags correctly', async () => {
        const { vscode } = renderChatApp();
        (vscode.postMessage as ReturnType<typeof vi.fn>).mockClear();

        const input = screen.getByTestId('message-input');
        input.focus();

        // 1. Type some text
        typeInInput('Check these files: ');

        // 2. Insert first file tag
        typeInInput('@file1');

        // Advance fake time past the debounce
        await vi.advanceTimersByTimeAsync(500);

        expect(vscode.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({ command: 'requestFileSuggestions' })
        );

        const calls1 = (vscode.postMessage as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
        const req1 = calls1.find((m: { command: string }) => m.command === 'requestFileSuggestions');
        const reqId1 = req1?.requestId;

        await act(async () => {
            window.dispatchEvent(new MessageEvent('message', {
                data: {
                    command: 'fileSuggestionsResponse',
                    suggestions: [{
                        path: '/workspace/file1.ts',
                        relativePath: 'file1.ts',
                        name: 'file1.ts',
                        extension: 'ts',
                        icon: 'codicon-file',
                        isDirectory: false
                    }],
                    filterText: 'file1',
                    requestId: reqId1
                }
            }));
        });

        // Verify suggestion item appeared
        expect(document.querySelector('.suggestion-item')).toBeInTheDocument();

        await act(async () => {
            fireEvent.keyDown(input, { key: 'Enter' });
        });

        // 3. Type more text
        typeInInput('and also ');

        // 4. Insert second file tag
        (vscode.postMessage as ReturnType<typeof vi.fn>).mockClear();
        typeInInput('@file2');

        await vi.advanceTimersByTimeAsync(500);

        expect(vscode.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({ command: 'requestFileSuggestions' })
        );

        const calls2 = (vscode.postMessage as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
        const req2 = calls2.find((m: { command: string }) => m.command === 'requestFileSuggestions');
        const reqId2 = req2?.requestId;

        await act(async () => {
            window.dispatchEvent(new MessageEvent('message', {
                data: {
                    command: 'fileSuggestionsResponse',
                    suggestions: [{
                        path: '/workspace/file2.ts',
                        relativePath: 'file2.ts',
                        name: 'file2.ts',
                        extension: 'ts',
                        icon: 'codicon-file',
                        isDirectory: false
                    }],
                    filterText: 'file2',
                    requestId: reqId2
                }
            }));
        });

        expect(document.querySelector('.suggestion-item')).toBeInTheDocument();

        await act(async () => {
            fireEvent.keyDown(input, { key: 'Enter' });
        });

        // 5. Verify input content
        const tags = document.querySelectorAll('#messageInput .context-tag');
        expect(tags.length).toBe(2);
        expect(tags[0]).toHaveTextContent('file1.ts');
        expect(tags[1]).toHaveTextContent('file2.ts');

        // 6. Send and verify markdown
        (vscode.postMessage as ReturnType<typeof vi.fn>).mockClear();
        await act(async () => {
            fireEvent.click(screen.getByTestId('send-btn'));
        });

        const sentMessages = (vscode.postMessage as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
        const sendMsg = sentMessages.find((m: { command: string }) => m.command === 'sendMessage') as Record<string, unknown>;
        expect(sendMsg).toBeDefined();
        const sentMarkdown = ((sendMsg.text as string) || '').replace(/\u00A0/g, ' ').trim();
        expect(sentMarkdown).toBe('Check these files: [@file:file1.ts] and also [@file:file2.ts]');
    });

    it('should insert inline selection tag and render it in history', async () => {
        const { vscode } = renderChatApp();
        (vscode.postMessage as ReturnType<typeof vi.fn>).mockClear();

        // 1. Simulate "Add to Wave" command from extension
        const selection = {
            filePath: '/workspace/src/app.ts',
            fileName: 'app.ts',
            startLine: 1,
            endLine: 10,
            selectedText: 'console.log("hello");',
            isEmpty: false
        };

        await act(async () => {
            window.dispatchEvent(new MessageEvent('message', {
                data: { command: 'addSelectionToInput', selection }
            }));
        });

        // 2. Verify inline tag is inserted in the input
        const inlineTag = document.querySelector('#messageInput .context-tag-container[data-is-selection="true"]');
        expect(inlineTag).toBeInTheDocument();
        expect(inlineTag).toHaveTextContent(/app\.ts#1-10/);

        // 3. Type and send
        const input = screen.getByTestId('message-input');
        input.focus();
        typeInInput('Check this: ');

        (vscode.postMessage as ReturnType<typeof vi.fn>).mockClear();
        await act(async () => {
            fireEvent.click(screen.getByTestId('send-btn'));
        });

        const sentMessages = (vscode.postMessage as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
        const sentMessage = sentMessages.find((m: { command: string }) => m.command === 'sendMessage') as Record<string, unknown>;

        // The markdown should contain the selection placeholder
        expect(sentMessage.text).toContain('[Selection: /workspace/src/app.ts|app.ts#1-10]');
        // Selection property should be undefined as it's now inline
        expect(sentMessage.selection).toBeUndefined();
    });
});
