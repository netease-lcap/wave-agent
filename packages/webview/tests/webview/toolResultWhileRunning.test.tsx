import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderChatApp, sendCommand } from './test-utils';
import { BASH_TOOL_NAME, LSP_TOOL_NAME } from 'wave-agent-sdk';

describe('Tool Result While Running', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should display bash result while tool is running', () => {
        renderChatApp();

        // Create a bash tool message in 'running' stage with a result
        const bashRunningMessage = {
            id: 'msg-1',
            role: 'assistant',
            blocks: [
                { type: 'text', content: 'Running a command...' },
                {
                    type: 'tool',
                    name: BASH_TOOL_NAME,
                    parameters: JSON.stringify({ command: 'ls -la' }),
                    compactParams: 'ls -la',
                    stage: 'running',
                    result: 'total 0\ndrwxr-xr-x  2 user  group   64 Mar 28 10:00 .'
                }
            ]
        };

        sendCommand('updateMessages', { messages: [bashRunningMessage as unknown] });

        // Verify bash-command-unified is present (it contains both input and output)
        const unifiedBlock = document.querySelector('.bash-command-unified');
        expect(unifiedBlock).toBeInTheDocument();

        // Verify command is shown
        const command = document.querySelector('.bash-command');
        expect(command).toHaveTextContent('ls -la');

        // Verify result is shown even though stage is 'running'
        const output = document.querySelector('.bash-command-output');
        expect(output).toHaveTextContent(/total 0/);
    });

    it('should display LSP result while tool is running', () => {
        renderChatApp();

        // Create an LSP tool message in 'running' stage with a result
        const lspRunningMessage = {
            id: 'msg-2',
            role: 'assistant',
            blocks: [
                { type: 'text', content: 'Finding definition...' },
                {
                    type: 'tool',
                    name: LSP_TOOL_NAME,
                    parameters: JSON.stringify({ operation: 'goToDefinition', filePath: 'test.ts', line: 1, character: 1 }),
                    compactParams: 'goToDefinition test.ts:1:1',
                    stage: 'running',
                    result: 'Definition found at test.ts:10:5'
                }
            ]
        };

        sendCommand('updateMessages', { messages: [lspRunningMessage as unknown] });

        // Verify lsp-output is present
        const lspOutput = document.querySelector('.lsp-output');
        expect(lspOutput).toBeInTheDocument();
        expect(lspOutput).toHaveTextContent('Definition found at test.ts:10:5');
    });

    it('should display shortResult if result is not present while running', () => {
        renderChatApp();

        // Create a tool message with shortResult
        const toolMessage = {
            id: 'msg-3',
            role: 'assistant',
            blocks: [
                {
                    type: 'tool',
                    name: 'some-other-tool',
                    stage: 'running',
                    shortResult: 'Intermediate progress...'
                }
            ]
        };

        sendCommand('updateMessages', { messages: [toolMessage as unknown] });

        // Verify result-raw is present and contains shortResult
        const resultRaw = document.querySelector('.result-raw');
        expect(resultRaw).toBeInTheDocument();
        expect(resultRaw).toHaveTextContent('Intermediate progress...');
    });
});
