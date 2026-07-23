import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderChatApp, sendCommand, fireEvent, act, waitFor } from './test-utils';
import { MockDataGenerator } from '../fixtures/mockData';
import { READ_TOOL_NAME } from 'wave-agent-sdk';

describe('Read tool header click → openFile with line range', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should send startLine/endLine derived from offset/limit when clicking the Read tool path', async () => {
        const { vscode } = renderChatApp();

        const messages = [
            MockDataGenerator.createAssistantMessageWithTool(
                "I'll read a slice of the file.",
                READ_TOOL_NAME,
                '{"file_path": "/home/user/project/src/styles/QueuedMessageList.css", "offset": 56, "limit": 10}',
                "File contents read successfully"
            )
        ];

        sendCommand('updateMessages', { messages });

        // The Read tool renders a clickable file-tool header path (stage === 'end').
        const pathEl = await waitFor(() => {
            const el = document.querySelector('.write-tool-path') as HTMLElement;
            expect(el).toBeInTheDocument();
            return el;
        });

        // Display text carries the offset:limit suffix.
        expect(pathEl).toHaveTextContent(/QueuedMessageList\.css:56:10/);

        (vscode.postMessage as ReturnType<typeof vi.fn>).mockClear();
        await act(async () => {
            fireEvent.click(pathEl);
        });

        const sent = (vscode.postMessage as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
        const openFileMsg = sent.find((m: { command: string }) => m.command === 'openFile') as Record<string, unknown>;
        expect(openFileMsg).toBeDefined();
        // Absolute path is forwarded for the jump.
        expect(openFileMsg.path).toBe('/home/user/project/src/styles/QueuedMessageList.css');
        // offset 56 → startLine 56; limit 10 → endLine 65 (offset + limit - 1).
        expect(openFileMsg.startLine).toBe(56);
        expect(openFileMsg.endLine).toBe(65);
    });

    it('should send startLine without endLine when only offset is provided', async () => {
        const { vscode } = renderChatApp();

        const messages = [
            MockDataGenerator.createAssistantMessageWithTool(
                "Reading from a line.",
                READ_TOOL_NAME,
                '{"file_path": "/home/user/project/src/foo.ts", "offset": 42}',
                "done"
            )
        ];

        sendCommand('updateMessages', { messages });

        const pathEl = await waitFor(() => {
            const el = document.querySelector('.write-tool-path') as HTMLElement;
            expect(el).toBeInTheDocument();
            return el;
        });

        (vscode.postMessage as ReturnType<typeof vi.fn>).mockClear();
        await act(async () => {
            fireEvent.click(pathEl);
        });

        const sent = (vscode.postMessage as ReturnType<typeof vi.fn>).mock.calls.map(c => c[0]);
        const openFileMsg = sent.find((m: { command: string }) => m.command === 'openFile') as Record<string, unknown>;
        expect(openFileMsg).toBeDefined();
        expect(openFileMsg.startLine).toBe(42);
        // No limit → no endLine (undefined is dropped by JSON.stringify).
        expect(openFileMsg.endLine).toBeUndefined();
    });
});
