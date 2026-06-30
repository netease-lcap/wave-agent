import { test, expect } from '../utils/webviewTestHarness.js';
import { MessageInjector } from '../utils/messageInjector.js';

test.describe('Plan Mode Initialization', () => {
    test('should correctly initialize in plan mode when defaultMode is set to plan', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);

        // Simulate webviewReady and extension responding with initial state where permissionMode is 'plan'
        await injector.simulateExtensionMessage('setInitialState', {
            messages: [],
            subagentMessages: {},
            inputContent: '',
            isStreaming: false,
            sessions: [],
            configurationData: {
                baseURL: 'https://api.example.com',
                model: 'gpt-4',
                fastModel: 'gpt-3.5',
                apiKey: 'test-key'
            },
            permissionMode: 'plan'
        });

        // Verify the permission mode select shows "计划模式"
        const select = webviewPage.locator('.permission-mode-select');
        await expect(select).toBeVisible();
        await expect(select).toHaveValue('plan');
        await expect(select).toHaveClass(/mode-plan/);

        // Verify that no error message like "plan file not set" is displayed
        // (Assuming errors are displayed in the message container or as a notification)
        const errorMessages = webviewPage.locator('.error-message, .message.error');
        await expect(errorMessages).toHaveCount(0);
    });
});
