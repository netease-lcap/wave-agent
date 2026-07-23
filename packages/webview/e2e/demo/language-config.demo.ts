import { test, expect } from '../utils/webviewTestHarness.js';

test.describe('Language Configuration Demo', () => {
    test('should show language field in configuration dialog', async ({ webviewPage }) => {
        // Simulate the extension sending showConfiguration (opens ConfigDialog via /config)
        await webviewPage.evaluate(() => {
            window.simulateExtensionMessage({
                command: 'showConfiguration',
                configurationData: {
                    apiKey: 'sk-ant-api03-CXB9pH2k...mH8wQz',
                    headers: '',
                    baseURL: 'https://api.nebula-tech.com/v1',
                    model: 'claude-sonnet-4-20250514',
                    fastModel: 'claude-haiku-4-20250514',
                    backendLink: 'https://wave.nebula-tech.com',
                    language: 'Chinese'
                }
            });
        });

        // Check if the configuration dialog is visible
        await expect(webviewPage.getByRole('heading', { name: '设置' })).toBeVisible();

        // Scroll to the language field in the scrollable area
        const languageField = webviewPage.locator('label[for="language"]');
        await expect(languageField).toBeAttached();
        await languageField.scrollIntoViewIfNeeded();

        // Verify the language field is visible and has the correct value
        await expect(languageField).toBeVisible();
        await expect(webviewPage.locator('#language')).toHaveValue('Chinese');

        // Take screenshot of the dialog with language field in view
        const dialog = webviewPage.locator('.configuration-dialog');
        await dialog.screenshot({ path: '../../docs/public/screenshots/language-config-ui.png' });
    });
});
