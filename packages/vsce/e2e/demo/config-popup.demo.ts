import { test, expect } from '../utils/webviewTestHarness.js';

test.describe('Configuration Popup Demo', () => {
    test('should show configuration dialog when config is missing', async ({ webviewPage }) => {
        // Simulate the extension sending the showConfiguration command (opens ConfigDialog)
        await webviewPage.evaluate(() => {
            window.simulateExtensionMessage({
                command: 'showConfiguration',
                configurationData: {
                    apiKey: '',
                    baseURL: '',
                    model: 'gemini-3-flash',
                    fastModel: 'gemini-2.5-flash'
                },
                error: '请先在设置中配置鉴权信息 (API Key 或 Headers) 和 Base URL。也可以通过环境变量 WAVE_API_KEY/WAVE_CUSTOM_HEADERS 和 WAVE_BASE_URL 进行配置。'
            });
        });

        // Check if the configuration dialog is visible
        await expect(webviewPage.getByText('配置设置', { exact: true })).toBeVisible();
        
        // Take screenshot to manually verify UI
        await webviewPage.screenshot({ path: '../../docs/public/screenshots/config-popup-updated-ui.png' });
    });

    test('should NOT show configuration dialog when config is provided (simulated)', async ({ webviewPage }) => {
        // The extension wouldn't send showConfiguration when config is valid
        // We just verify the normal chat interface is there
        await expect(webviewPage.getByTestId('chat-container')).toBeVisible();
        await expect(webviewPage.getByText('配置设置', { exact: true })).not.toBeVisible(); // The dialog title
        
        await webviewPage.screenshot({ path: '../../docs/public/screenshots/config-not-needed.png' });
    });
});
