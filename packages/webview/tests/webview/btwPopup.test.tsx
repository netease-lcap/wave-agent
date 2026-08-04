import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderChatApp, screen, waitFor, fireEvent, act, sendCommand, fireInput } from './test-utils';

/** Set contenteditable text with selection inside a text node and fire input. */
async function typeInInput(text: string) {
    const input = screen.getByTestId('message-input');
    const existing = input.textContent || '';
    const fullText = existing + text;
    input.textContent = fullText;

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

    await fireInput(input, { data: text, inputType: 'insertText' });
}

/** Type text and click send, returning the mock vscode. */
async function sendText(text: string) {
    const { vscode } = renderChatApp();
    await typeInInput(text);
    act(() => {
        fireEvent.click(screen.getByTestId('send-btn'));
    });
    return vscode;
}

describe('/btw Popup', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('sends an askBtw RPC instead of a message and shows the loading panel', async () => {
        const vscode = await sendText('/btw what is the weather?');

        expect(vscode.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({ command: 'askBtw', question: 'what is the weather?' })
        );
        expect(vscode.postMessage).not.toHaveBeenCalledWith(
            expect.objectContaining({ command: 'sendMessage' })
        );

        expect(screen.getByTestId('btw-panel')).toBeInTheDocument();
        expect(screen.getByTestId('btw-panel-question').textContent).toBe('what is the weather?');
        expect(screen.getByTestId('btw-panel-loading')).toBeInTheDocument();
        expect(screen.getByText('正在回答…')).toBeInTheDocument();
        // No emoji — the ▋ cursor blink is aligned with the message list
        expect(screen.getByTestId('btw-panel-loading').textContent).toContain('▋');
    });

    it('streams thinking chunks live, then discards them once content starts', async () => {
        await sendText('/btw what is the weather?');
        expect(screen.getByTestId('btw-panel-loading')).toBeInTheDocument();

        // Thinking chunks stream live while the model reasons…
        act(() => {
            sendCommand('btwStream', { question: 'what is the weather?', content: 'Let me think', type: 'thinking' });
        });
        act(() => {
            sendCommand('btwStream', { question: 'what is the weather?', content: ' about it.', type: 'thinking' });
        });
        expect(screen.getByTestId('btw-panel-streaming').textContent).toBe('Let me think about it.');

        // …but the first content chunk discards the accumulated thinking text
        act(() => {
            sendCommand('btwStream', { question: 'what is the weather?', content: 'Sunny', type: 'content' });
        });
        act(() => {
            sendCommand('btwStream', { question: 'what is the weather?', content: ' and 25°C', type: 'content' });
        });
        expect(screen.getByTestId('btw-panel-streaming').textContent).toBe('Sunny and 25°C');
        expect(screen.getByTestId('btw-panel-streaming').textContent).not.toContain('Let me think');

        // A late thinking chunk after content started is ignored too
        act(() => {
            sendCommand('btwStream', { question: 'what is the weather?', content: 'stale reasoning', type: 'thinking' });
        });
        expect(screen.getByTestId('btw-panel-streaming').textContent).toBe('Sunny and 25°C');

        // The finished answer still lands via btwResponse and renders as markdown
        act(() => {
            sendCommand('btwResponse', { question: 'what is the weather?', answer: '**Sunny** and 25°C' });
        });
        await waitFor(() => {
            expect(screen.getByTestId('btw-panel-answer')).toBeInTheDocument();
        });
        expect(screen.queryByTestId('btw-panel-streaming')).not.toBeInTheDocument();
    });

    it('renders the answer as markdown when btwResponse arrives', async () => {
        await sendText('/btw what is the weather?');

        act(() => {
            sendCommand('btwResponse', { question: 'what is the weather?', answer: '**Sunny** and 25°C' });
        });

        await waitFor(() => {
            expect(screen.getByTestId('btw-panel-answer')).toBeInTheDocument();
        });
        expect(screen.queryByTestId('btw-panel-loading')).not.toBeInTheDocument();
        // dangerouslySetInnerHTML receives the rendered markdown (DOMPurify is mocked to pass through)
        expect(screen.getByTestId('btw-panel-answer').innerHTML).toContain('<strong>Sunny</strong>');
    });

    it('bare /btw shows the usage hint without sending anything', async () => {
        const vscode = await sendText('/btw');

        expect(vscode.postMessage).not.toHaveBeenCalledWith(
            expect.objectContaining({ command: 'askBtw' })
        );
        expect(vscode.postMessage).not.toHaveBeenCalledWith(
            expect.objectContaining({ command: 'sendMessage' })
        );

        expect(screen.getByTestId('btw-panel')).toBeInTheDocument();
        // The `/btw ` prefix is always rendered (spec scenario 3) so the header
        // keeps a title and the close button stays on the right.
        expect(screen.getByText('/btw')).toBeInTheDocument();
        expect(screen.getByTestId('btw-panel-close')).toBeInTheDocument();
        await waitFor(() => {
            expect(screen.getByText('Usage: /btw <your question>')).toBeInTheDocument();
        });
    });

    it('close button hides the panel and a late reply is dropped', async () => {
        const vscode = await sendText('/btw what is the weather?');

        act(() => {
            fireEvent.click(screen.getByTestId('btw-panel-close'));
        });
        expect(screen.queryByTestId('btw-panel')).not.toBeInTheDocument();

        // Reply arriving after close must not resurrect the panel
        act(() => {
            sendCommand('btwResponse', { question: 'what is the weather?', answer: 'Sunny' });
        });
        expect(screen.queryByTestId('btw-panel')).not.toBeInTheDocument();
        expect(vscode.postMessage).not.toHaveBeenCalledWith(
            expect.objectContaining({ command: 'sendMessage' })
        );
    });

    it('Escape closes the panel', async () => {
        await sendText('/btw what is the weather?');
        expect(screen.getByTestId('btw-panel')).toBeInTheDocument();

        act(() => {
            fireEvent.keyDown(document, { key: 'Escape' });
        });
        expect(screen.queryByTestId('btw-panel')).not.toBeInTheDocument();
    });

    it('Escape while streaming closes only the panel, never aborting the agent loop', async () => {
        const vscode = await sendText('/btw what is the weather?');
        // The main conversation is streaming — a plain Escape on the input would
        // normally fire onAbortMessage (MessageInput.tsx:1020). The btw panel's
        // capture-phase listener must swallow it first (spec scenario 9).
        act(() => {
            sendCommand('startStreaming');
        });

        const input = screen.getByTestId('message-input');
        input.focus();
        act(() => {
            fireEvent.keyDown(input, { key: 'Escape' });
        });

        expect(screen.queryByTestId('btw-panel')).not.toBeInTheDocument();
        expect(vscode.postMessage).not.toHaveBeenCalledWith(
            expect.objectContaining({ command: 'abortMessage' })
        );
        // The main conversation keeps streaming
        expect(screen.getByTestId('message-input')).toBeInTheDocument();
    });

    it('shows an API error string when btwError arrives', async () => {
        await sendText('/btw what is the weather?');

        act(() => {
            sendCommand('btwError', { question: 'what is the weather?', error: 'rate limited' });
        });

        await waitFor(() => {
            expect(screen.getByText('(API error: rate limited)')).toBeInTheDocument();
        });
        expect(screen.queryByTestId('btw-panel-loading')).not.toBeInTheDocument();
    });

    it('ignores a stale reply whose question does not match the active one', async () => {
        await sendText('/btw first question');
        expect(screen.getByTestId('btw-panel-loading')).toBeInTheDocument();

        act(() => {
            sendCommand('btwResponse', { question: 'some other question', answer: 'stale answer' });
        });

        // Still loading — the stale reply was dropped
        expect(screen.getByTestId('btw-panel-loading')).toBeInTheDocument();
        expect(screen.queryByTestId('btw-panel-answer')).not.toBeInTheDocument();
    });

    it('selecting /btw in the slash popup inserts the prefix without sending', async () => {
        const { vscode } = renderChatApp();
        const input = screen.getByTestId('message-input');
        input.focus();

        await typeInInput('/');
        await waitFor(() => {
            expect(vscode.postMessage).toHaveBeenCalledWith(
                expect.objectContaining({ command: 'requestSlashCommands' })
            );
        }, { timeout: 3000 });

        sendCommand('slashCommandsResponse', {
            commands: [
                { id: 'btw', name: 'btw', description: 'Ask a side question' },
                { id: 'config', name: 'config', description: 'Configuration' }
            ]
        });

        await waitFor(() => {
            expect(screen.getByTestId('slash-commands-popup')).toBeInTheDocument();
        });

        await act(async () => {
            fireEvent.keyDown(input, { key: 'Enter' });
        });

        // btw groups under 系统指令 with config; order = [config, btw]? No —
        // popup order follows groupSlashCommands: plugin, system (in listed
        // order), skills. Just assert the prefix text was inserted.
        await waitFor(() => {
            expect(input.textContent).toBe('/btw ');
        });
        expect(vscode.postMessage).not.toHaveBeenCalledWith(
            expect.objectContaining({ command: 'askBtw' })
        );
        expect(vscode.postMessage).not.toHaveBeenCalledWith(
            expect.objectContaining({ command: 'sendMessage' })
        );
    });
});
