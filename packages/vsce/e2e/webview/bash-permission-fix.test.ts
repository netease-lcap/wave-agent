/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect } from '../utils/webviewTestHarness.js';
import { MessageInjector } from '../utils/messageInjector.js';
import { BASH_TOOL_NAME } from 'wave-agent-sdk';

test.describe('Bash Permission Fix', () => {
    test('should send correct permission rule without double asterisk', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);

        // Set initial state
        await injector.simulateExtensionMessage('setInitialState', {
            messages: [],
            isStreaming: false,
            sessions: [],
            configurationData: {
                apiKey: 'test-key',
                baseURL: 'https://api.example.com',
                model: 'gpt-4'
            },
            permissionMode: 'default'
        });

        // Show Bash confirmation with suggestedPrefix
        const suggestedPrefix = 'npm run dev';
        await injector.simulateExtensionMessage('showConfirmation', {
            confirmationId: 'bash-confirm-123',
            toolName: BASH_TOOL_NAME,
            confirmationType: 'Bash 命令执行确认',
            toolInput: {
                command: 'npm run dev:watch'
            },
            suggestedPrefix: suggestedPrefix
        });

        // Wait for confirmation dialog
        await webviewPage.waitForSelector('.confirmation-dialog');

        // Click "Yes, and don't ask again" button
        // The button text is "是，且不再询问：npm run dev"
        const autoButton = webviewPage.locator('.confirmation-btn-auto');
        await expect(autoButton).toContainText(`不再询问：${suggestedPrefix}`);
        
        // Clear previous messages
        await webviewPage.evaluate(() => {
            window.clearTestMessages();
        });

        await autoButton.click();

        // Check the message sent back to extension
        const messages = await webviewPage.evaluate(() => {
            return window.getTestMessages();
        });

        const response = messages.find((m) => m.command === 'confirmationResponse') as any;
        expect(response).toBeDefined();
        expect(response.decision.newPermissionRule).toBe(`Bash(${suggestedPrefix})`);
        // It should NOT be `Bash(${suggestedPrefix}:*)`
        expect(response.decision.newPermissionRule).not.toContain(':*');
    });
});
