import { test, expect } from '../utils/webviewTestHarness.js';

test.describe('Language Configuration Demo', () => {
    test('should show language field in configuration dialog', async ({ webviewPage }) => {
        // Simulate the extension sending showConfiguration (opens ConfigDialog via /config)
        await webviewPage.evaluate(() => {
            window.simulateExtensionMessage({
                command: 'showConfiguration',
                configurationData: {
                    apiKey: 'test-key',
                    headers: '',
                    baseURL: 'https://api.example.com',
                    model: 'gemini-3-flash',
                    fastModel: 'gemini-2.5-flash',
                    backendLink: 'https://backend.example.com',
                    language: 'English'
                }
            });
        });

        // Check if the configuration dialog is visible
        await expect(webviewPage.getByText('配置设置', { exact: true })).toBeVisible();

        // Scroll to the language field in the scrollable area
        const languageField = webviewPage.locator('label[for="language"]');
        await expect(languageField).toBeAttached();
        await languageField.scrollIntoViewIfNeeded();

        // Verify the language field is visible and has the correct value
        await expect(languageField).toBeVisible();
        await expect(webviewPage.locator('#language')).toHaveValue('English');

        // Take screenshot of the dialog with language field in view
        const dialog = webviewPage.locator('.configuration-dialog');
        await dialog.screenshot({ path: 'docs/public/screenshots/language-config-ui.png' });
    });
});
