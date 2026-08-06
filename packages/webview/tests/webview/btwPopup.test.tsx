import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderChatApp, screen, waitFor, fireEvent, act, sendCommand, fireInput, sendHostMessage } from './test-utils';
import { fixtures } from 'wave-webview-fixtures';

/** A minimal SessionMetadata for conversation-switch tests. */
function session(id: string) {
    return { id, sessionType: 'main' as const, workdir: '/tmp/test', createdAt: new Date(), lastActiveAt: new Date(), latestTotalTokens: 0 };
}

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

    it('does not show streaming chunks while loading and renders the finished answer as markdown', async () => {
        await sendText('/btw what is the weather?');
        expect(screen.getByTestId('btw-panel-loading')).toBeInTheDocument();
        expect(screen.queryByTestId('btw-panel-streaming')).not.toBeInTheDocument();

        // Streaming chunks (thinking or content) are never displayed while loading
        act(() => {
            sendCommand('btwStream', { question: 'what is the weather?', content: 'Let me think', type: 'thinking' });
        });
        act(() => {
            sendCommand('btwStream', { question: 'what is the weather?', content: ' about it.', type: 'thinking' });
        });
        act(() => {
            sendCommand('btwStream', { question: 'what is the weather?', content: 'Sunny', type: 'content' });
        });
        act(() => {
            sendCommand('btwStream', { question: 'what is the weather?', content: ' and 25°C', type: 'content' });
        });
        expect(screen.queryByTestId('btw-panel-streaming')).not.toBeInTheDocument();
        expect(screen.getByTestId('btw-panel').textContent).not.toContain('Let me think');
        expect(screen.getByTestId('btw-panel').textContent).not.toContain('Sunny');
        expect(screen.getByTestId('btw-panel-loading')).toBeInTheDocument();

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
            expect(screen.getByText('用法：/btw <你的问题>')).toBeInTheDocument();
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

    it('switching conversations closes the btw panel (conversation-scoped)', async () => {
        renderChatApp();
        // Desktop pushes setInitialState with the activated session on a sidebar
        // conversation switch (pushPaneSessionState). Establish conversation A.
        sendHostMessage(fixtures.setInitialState({ session: session('session-a') }));
        await typeInInput('/btw what is the weather?');
        act(() => {
            fireEvent.click(screen.getByTestId('send-btn'));
        });
        expect(screen.getByTestId('btw-panel')).toBeInTheDocument();

        // Switch to conversation B: the panel is conversation-scoped (spec
        // scenario 14) and must close — the new conversation never shows the
        // old one's panel. Desktop panes key ChatApp by paneId (not sessionId),
        // so this component stays mounted and only the session-id change in
        // setInitialState can dismiss the local btwPanel state.
        sendHostMessage(fixtures.setInitialState({ session: session('session-b') }));
        expect(screen.queryByTestId('btw-panel')).not.toBeInTheDocument();
    });

    it('drops a late btw reply that lands after switching conversations', async () => {
        const { vscode } = renderChatApp();
        sendHostMessage(fixtures.setInitialState({ session: session('session-a') }));
        await typeInInput('/btw what is the weather?');
        act(() => {
            fireEvent.click(screen.getByTestId('send-btn'));
        });
        expect(screen.getByTestId('btw-panel-loading')).toBeInTheDocument();

        // Switch while the askBtw RPC is still in flight: closing clears
        // btwActiveRef, so the reply that lands in the new conversation is
        // dropped (spec scenario 14: 若切换发生在加载中，旧请求的迟到回复同样被丢弃).
        sendHostMessage(fixtures.setInitialState({ session: session('session-b') }));
        expect(screen.queryByTestId('btw-panel')).not.toBeInTheDocument();

        act(() => {
            sendCommand('btwResponse', { question: 'what is the weather?', answer: 'Sunny' });
        });
        expect(screen.queryByTestId('btw-panel')).not.toBeInTheDocument();
        expect(vscode.postMessage).not.toHaveBeenCalledWith(
            expect.objectContaining({ command: 'sendMessage' })
        );
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
