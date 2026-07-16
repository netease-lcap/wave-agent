import { test, expect } from '../utils/webviewTestHarness.js';

test.describe('Login Dialog Demo', () => {
    test('should show login dialog with not-authenticated state', async ({ webviewPage }) => {
        // 1. Open the login dialog via showDialog
        await webviewPage.evaluate(() => {
            window.simulateExtensionMessage({
                command: 'showDialog',
                dialogType: 'login'
            });
        });

        // 2. Simulate auth status (not authenticated)
        await webviewPage.evaluate(() => {
            window.simulateExtensionMessage({
                command: 'authStatusResponse',
                isAuthenticated: false,
                user: null
            });
        });

        // Verify dialog title
        await expect(webviewPage.getByText('SSO 认证', { exact: true })).toBeVisible();

        // Verify login button is visible
        await expect(webviewPage.getByText('SSO 登录', { exact: true })).toBeVisible();

        // Take screenshot
        const dialog = webviewPage.locator('.configuration-dialog');
        await dialog.screenshot({ path: '../../docs/public/screenshots/spec-login-dialog.png' });
    });

    test('should show login dialog with authenticated state', async ({ webviewPage }) => {
        await webviewPage.evaluate(() => {
            window.simulateExtensionMessage({
                command: 'showDialog',
                dialogType: 'login'
            });
        });

        // Simulate authenticated state
        await webviewPage.evaluate(() => {
            window.simulateExtensionMessage({
                command: 'authStatusResponse',
                isAuthenticated: true,
                user: { id: 'usr_7f3k2d8x', email: 'sarah.chen@nebula-tech.com' }
            });
        });

        await expect(webviewPage.getByText('SSO 认证', { exact: true })).toBeVisible();
        await expect(webviewPage.getByText('sarah.chen@nebula-tech.com')).toBeVisible();
        await expect(webviewPage.getByText('登出', { exact: true })).toBeVisible();

        const dialog = webviewPage.locator('.configuration-dialog');
        await dialog.screenshot({ path: '../../docs/public/screenshots/spec-login-dialog-authenticated.png' });
    });
});
