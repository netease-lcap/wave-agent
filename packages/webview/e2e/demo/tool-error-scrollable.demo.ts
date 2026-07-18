import { test, expect } from '../utils/webviewTestHarness.js';
import { MessageInjector } from '../utils/messageInjector.js';
import { BASH_TOOL_NAME, type Message } from 'wave-agent-sdk';

test.describe('Tool Error Scrollable Demo', () => {
    test('should show scrollable tool error', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);

        await webviewPage.setViewportSize({ width: 400, height: 800 });

        await injector.simulateExtensionMessage('setInitialState', {
            messages: [],
            isStreaming: false,
            sessions: [],
            configurationData: {
                apiKey: 'sk-ant-api03-CXB9pH2k...mH8wQz',
                baseURL: 'https://api.anthropic.com/v1',
                model: 'claude-sonnet-4-20250514',
                fastModel: 'claude-haiku-4-20250514'
            },
            permissionMode: 'default'
        });

        const longError = 'Error: ' + 'a'.repeat(5000);
        const messageWithLongError = {
            id: 'msg_long_error',
            role: 'assistant',
            blocks: [
                {
                    type: 'tool',
                    name: BASH_TOOL_NAME,
                    stage: 'end',
                    compactParams: 'pnpm -F @nebula/payment-service build',
                    parameters: JSON.stringify({ command: 'pnpm -F @nebula/payment-service build' }),
                    error: longError,
                    success: false
                }
            ]
        };

        await injector.updateMessages([messageWithLongError as unknown as Message]);
        await webviewPage.waitForSelector('.tool-error');
        
        // Check if the error is displayed and has max-height
        const errorLocator = webviewPage.locator('.tool-error');
        const maxHeight = await errorLocator.evaluate(el => window.getComputedStyle(el).maxHeight);
        const overflowY = await errorLocator.evaluate(el => window.getComputedStyle(el).overflowY);
        

        
        expect(maxHeight).toBe('200px');
        expect(overflowY).toBe('auto');
        
        // Take a screenshot of the long error with scrollbar
        await webviewPage.screenshot({ path: '../../docs/public/screenshots/tool-error-scrollable.png' });
    });

    test('should show scrollable error block', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);

        await webviewPage.setViewportSize({ width: 400, height: 800 });

        await injector.simulateExtensionMessage('setInitialState', {
            messages: [],
            isStreaming: false,
            sessions: [],
            configurationData: {
                apiKey: 'sk-ant-api03-CXB9pH2k...mH8wQz',
                baseURL: 'https://api.anthropic.com/v1',
                model: 'claude-sonnet-4-20250514',
                fastModel: 'claude-haiku-4-20250514'
            },
            permissionMode: 'default'
        });

        const longError = 'Error: ' + 'b'.repeat(5000);
        const messageWithLongError = {
            id: 'msg_long_error_block',
            role: 'assistant',
            blocks: [
                {
                    type: 'error',
                    content: longError
                }
            ]
        };

        await injector.updateMessages([messageWithLongError as unknown as Message]);
        await webviewPage.waitForSelector('.message-content.error');
        
        // Check if the error is displayed and has max-height
        const errorLocator = webviewPage.locator('.message-content.error');
        const maxHeight = await errorLocator.evaluate(el => window.getComputedStyle(el).maxHeight);
        const overflowY = await errorLocator.evaluate(el => window.getComputedStyle(el).overflowY);
        

        
        expect(maxHeight).toBe('200px');
        expect(overflowY).toBe('auto');
        
        // Take a screenshot of the long error block with scrollbar
        await webviewPage.screenshot({ path: '../../docs/public/screenshots/error-block-scrollable.png' });
    });
});
