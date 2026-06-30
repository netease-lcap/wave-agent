import { test, expect } from '../utils/webviewTestHarness.js';

test.describe('Model Dialog Demo', () => {
    test('should show model dialog with pre-filled values', async ({ webviewPage }) => {
        // 1. Open the model dialog via showDialog
        await webviewPage.evaluate(() => {
            window.simulateExtensionMessage({
                command: 'showDialog',
                dialogType: 'model'
            });
        });

        // 2. Simulate extension sending configuration data
        await webviewPage.evaluate(() => {
            window.simulateExtensionMessage({
                command: 'configurationResponse',
                configurationData: {
                    model: 'claude-sonnet-4-20250514',
                    fastModel: 'claude-haiku-4-20250514'
                }
            });
        });

        // 3. Simulate extension sending configured models list
        await webviewPage.evaluate(() => {
            window.simulateExtensionMessage({
                command: 'configuredModelsResponse',
                models: ['claude-sonnet-4-20250514', 'claude-haiku-4-20250514', 'gpt-4', 'gpt-4-mini']
            });
        });

        // Verify dialog is visible
        await expect(webviewPage.getByText('模型设置', { exact: true })).toBeVisible();

        // Verify model select is pre-selected
        await expect(webviewPage.locator('#model-select')).toHaveValue('claude-sonnet-4-20250514');
        await expect(webviewPage.locator('#fast-model-select')).toHaveValue('claude-haiku-4-20250514');

        // Take screenshot
        const dialog = webviewPage.locator('.configuration-dialog');
        await dialog.screenshot({ path: 'docs/public/screenshots/spec-model-dialog.png' });
    });

    test('should show model dialog with empty values and env placeholders', async ({ webviewPage }) => {
        await webviewPage.evaluate(() => {
            window.simulateExtensionMessage({
                command: 'showDialog',
                dialogType: 'model'
            });
        });

        await webviewPage.evaluate(() => {
            window.simulateExtensionMessage({
                command: 'configurationResponse',
                configurationData: {
                    model: '',
                    fastModel: '',
                    envModel: 'WAVE_MODEL',
                    envFastModel: 'WAVE_FAST_MODEL'
                }
            });
        });

        // Simulate configured models (even with env vars, models list comes from SDK)
        await webviewPage.evaluate(() => {
            window.simulateExtensionMessage({
                command: 'configuredModelsResponse',
                models: ['gpt-4', 'gpt-4-mini']
            });
        });

        await expect(webviewPage.getByText('模型设置', { exact: true })).toBeVisible();

        // Verify select is shown with first option selected
        const modelSelect = webviewPage.locator('#model-select');
        await expect(modelSelect).toBeVisible();

        const dialog = webviewPage.locator('.configuration-dialog');
        await dialog.screenshot({ path: 'docs/public/screenshots/spec-model-dialog-empty.png' });
    });
});
