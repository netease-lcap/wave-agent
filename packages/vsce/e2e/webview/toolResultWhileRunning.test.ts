/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect } from '../utils/webviewTestHarness.js';
import { MessageInjector } from '../utils/messageInjector.js';
import { BASH_TOOL_NAME, LSP_TOOL_NAME } from 'wave-agent-sdk';

test.describe('Tool Result While Running', () => {
    test('should display bash result while tool is running', async ({ webviewPage }) => {
        const messageInjector = new MessageInjector(webviewPage);

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

        await messageInjector.updateMessages([bashRunningMessage as any]);

        // Verify bash-command-unified is present (it contains both input and output)
        const unifiedBlock = webviewPage.locator('.bash-command-unified');
        await expect(unifiedBlock).toBeVisible();

        // Verify command is shown
        const command = webviewPage.locator('.bash-command');
        await expect(command).toContainText('ls -la');

        // Verify result is shown even though stage is 'running'
        const output = webviewPage.locator('.bash-command-output');
        await expect(output).toContainText('total 0');
    });

    test('should display LSP result while tool is running', async ({ webviewPage }) => {
        const messageInjector = new MessageInjector(webviewPage);

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

        await messageInjector.updateMessages([lspRunningMessage as any]);

        // Verify lsp-output is present
        const lspOutput = webviewPage.locator('.lsp-output');
        await expect(lspOutput).toBeVisible();
        await expect(lspOutput).toContainText('Definition found at test.ts:10:5');
    });

    test('should display shortResult if result is not present while running', async ({ webviewPage }) => {
        const messageInjector = new MessageInjector(webviewPage);

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

        await messageInjector.updateMessages([toolMessage as any]);

        // Verify result-raw is present and contains shortResult
        const resultRaw = webviewPage.locator('.result-raw');
        await expect(resultRaw).toBeVisible();
        await expect(resultRaw).toContainText('Intermediate progress...');
    });
});
