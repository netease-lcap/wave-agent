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

        // 2. Simulate extension sending configuration data with serverUrl
        await webviewPage.evaluate(() => {
            window.simulateExtensionMessage({
                command: 'configurationResponse',
                configurationData: {
                    serverUrl: 'https://wave-ai.example.com'
                }
            });
        });

        // 3. Simulate auth status (not authenticated)
        await webviewPage.evaluate(() => {
            window.simulateExtensionMessage({
                command: 'authStatusResponse',
                isAuthenticated: false,
                user: null
            });
        });

        // Verify dialog title
        await expect(webviewPage.getByText('SSO 认证', { exact: true })).toBeVisible();

        // Verify server URL input is pre-filled
        const serverUrlInput = webviewPage.locator('#login-serverUrl');
        await expect(serverUrlInput).toHaveValue('https://wave-ai.example.com');

        // Verify login button is visible
        await expect(webviewPage.getByText('SSO 登录', { exact: true })).toBeVisible();

        // Take screenshot
        const dialog = webviewPage.locator('.configuration-dialog');
        await dialog.screenshot({ path: 'docs/public/screenshots/spec-login-dialog.png' });
    });

    test('should show login dialog with authenticated state', async ({ webviewPage }) => {
        await webviewPage.evaluate(() => {
            window.simulateExtensionMessage({
                command: 'showDialog',
                dialogType: 'login'
            });
        });

        await webviewPage.evaluate(() => {
            window.simulateExtensionMessage({
                command: 'configurationResponse',
                configurationData: {
                    serverUrl: 'https://wave-ai.example.com'
                }
            });
        });

        // Simulate authenticated state
        await webviewPage.evaluate(() => {
            window.simulateExtensionMessage({
                command: 'authStatusResponse',
                isAuthenticated: true,
                user: { id: 'user-xyz789', email: 'alice@example.com' }
            });
        });

        await expect(webviewPage.getByText('SSO 认证', { exact: true })).toBeVisible();
        await expect(webviewPage.getByText('alice@example.com')).toBeVisible();
        await expect(webviewPage.getByText('登出', { exact: true })).toBeVisible();

        const dialog = webviewPage.locator('.configuration-dialog');
        await dialog.screenshot({ path: 'docs/public/screenshots/spec-login-dialog-authenticated.png' });
    });

    test('should show editable serverUrl input when no server URL configured', async ({ webviewPage }) => {
        await webviewPage.evaluate(() => {
            window.simulateExtensionMessage({
                command: 'showDialog',
                dialogType: 'login'
            });
        });

        // No serverUrl configured
        await webviewPage.evaluate(() => {
            window.simulateExtensionMessage({
                command: 'configurationResponse',
                configurationData: {}
            });
        });

        await webviewPage.evaluate(() => {
            window.simulateExtensionMessage({
                command: 'authStatusResponse',
                isAuthenticated: false,
                user: null
            });
        });

        await expect(webviewPage.getByText('SSO 认证', { exact: true })).toBeVisible();

        // ServerUrl input should be visible and empty
        const serverUrlInput = webviewPage.locator('#login-serverUrl');
        await expect(serverUrlInput).toBeVisible();
        await expect(serverUrlInput).toHaveValue('');

        // Login button should be disabled when serverUrl is empty
        const loginBtn = webviewPage.getByText('SSO 登录', { exact: true });
        await expect(loginBtn).toBeDisabled();

        const dialog = webviewPage.locator('.configuration-dialog');
        await dialog.screenshot({ path: 'docs/public/screenshots/spec-login-dialog-no-url.png' });
    });
});
