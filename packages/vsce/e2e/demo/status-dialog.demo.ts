import { test, expect } from '../utils/webviewTestHarness.js';

test.describe('Status Dialog Demo', () => {
    test('should show status dialog with all info fields', async ({ webviewPage }) => {
        // 1. Open the status dialog via showDialog
        await webviewPage.evaluate(() => {
            window.simulateExtensionMessage({
                command: 'showDialog',
                dialogType: 'status'
            });
        });

        // 2. Simulate extension sending configuration data
        await webviewPage.evaluate(() => {
            window.simulateExtensionMessage({
                command: 'configurationResponse',
                configurationData: {
                    model: 'claude-sonnet-4-20250514',
                    fastModel: 'claude-haiku-4-20250514',
                    baseURL: 'https://api.nebula-tech.com/v1',
                    serverUrl: 'https://wave.nebula-tech.com'
                }
            });
        });

        // 3. Simulate extension sending status response
        await webviewPage.evaluate(() => {
            window.simulateExtensionMessage({
                command: 'statusResponse',
                version: '1.2.0',
                sessionId: 'sess_a1b2c3d4-e5f6-7890-abcd-ef1234567890',
                workdir: '/home/dev/projects/nebula-platform',
                configurationData: {
                    model: 'claude-sonnet-4-20250514',
                    fastModel: 'claude-haiku-4-20250514',
                    baseURL: 'https://api.nebula-tech.com/v1',
                    serverUrl: 'https://wave.nebula-tech.com'
                }
            });
        });

        // 4. Simulate auth status (authenticated)
        await webviewPage.evaluate(() => {
            window.simulateExtensionMessage({
                command: 'authStatusResponse',
                isAuthenticated: true,
                user: { id: 'usr_7f3k2d8x', email: 'sarah.chen@nebula-tech.com' }
            });
        });

        // Verify dialog title
        await expect(webviewPage.getByText('状态信息', { exact: true })).toBeVisible();

        // Verify key info fields are displayed
        await expect(webviewPage.getByText('1.2.0')).toBeVisible();
        await expect(webviewPage.getByText('sess_a1b2c3d4-e5f6-7890-abcd-ef1234567890')).toBeVisible();
        await expect(webviewPage.getByText('/home/dev/projects/nebula-platform')).toBeVisible();
        await expect(webviewPage.getByText('claude-sonnet-4-20250514').first()).toBeVisible();
        await expect(webviewPage.getByText('sarah.chen@nebula-tech.com')).toBeVisible();

        // Take screenshot
        const dialog = webviewPage.locator('.configuration-dialog');
        await dialog.screenshot({ path: '../../docs/public/screenshots/spec-status-dialog.png' });
    });

    test('should show status dialog with unauthenticated state', async ({ webviewPage }) => {
        await webviewPage.evaluate(() => {
            window.simulateExtensionMessage({
                command: 'showDialog',
                dialogType: 'status'
            });
        });

        // Simulate status with minimal config
        await webviewPage.evaluate(() => {
            window.simulateExtensionMessage({
                command: 'statusResponse',
                version: '1.2.0',
                sessionId: '',
                workdir: '',
                configurationData: {}
            });
        });

        // Simulate not authenticated
        await webviewPage.evaluate(() => {
            window.simulateExtensionMessage({
                command: 'authStatusResponse',
                isAuthenticated: false,
                user: null
            });
        });

        await expect(webviewPage.getByText('状态信息', { exact: true })).toBeVisible();
        await expect(webviewPage.getByText('未登录')).toBeVisible();

        const dialog = webviewPage.locator('.configuration-dialog');
        await dialog.screenshot({ path: '../../docs/public/screenshots/spec-status-dialog-noauth.png' });
    });
});
