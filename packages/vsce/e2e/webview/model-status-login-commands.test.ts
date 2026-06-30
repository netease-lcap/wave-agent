/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect } from '../utils/webviewTestHarness.js';

/**
 * Test /model, /status, /login slash commands
 * These commands are intercepted locally (never sent to agent SDK) and open dialogs.
 */

test.describe('Model/Status/Login Slash Commands', () => {
  test('should open model dialog when /model is typed and Enter pressed', async ({ webviewPage }) => {
    const input = webviewPage.getByTestId('message-input');
    await input.focus();

    // Simulate extension sending configuration data first
    await webviewPage.evaluate(() => {
      window.simulateExtensionMessage({
        command: 'configurationResponse',
        configurationData: {
          model: 'gpt-4',
          fastModel: 'gpt-4-mini',
          baseURL: 'https://api.example.com/v1',
          serverUrl: 'https://wave.example.com'
        }
      });
    });

    // Simulate extension sending configured models list
    await webviewPage.evaluate(() => {
      window.simulateExtensionMessage({
        command: 'configuredModelsResponse',
        models: ['gpt-4', 'gpt-4-mini', 'gpt-4-turbo']
      });
    });

    // Type /model and press Enter
    await input.type('/model');
    await webviewPage.keyboard.press('Enter');

    // Verify model dialog is visible
    await expect(webviewPage.getByText('模型设置', { exact: true })).toBeVisible();

    // Verify model select is pre-selected
    const modelSelect = webviewPage.locator('#model-select');
    await expect(modelSelect).toHaveValue('gpt-4');

    const fastModelSelect = webviewPage.locator('#fast-model-select');
    await expect(fastModelSelect).toHaveValue('gpt-4-mini');

    // Verify sendMessage was NOT sent to extension (it's a local command)
    const messages = await webviewPage.evaluate(() => window.getTestMessages());
    expect(messages.some((m: Record<string, unknown>) => m.command === 'sendMessage')).toBe(false);
  });

  test('should open status dialog when /status is typed and Enter pressed', async ({ webviewPage }) => {
    const input = webviewPage.getByTestId('message-input');
    await input.focus();

    // Type /status and press Enter
    await input.type('/status');
    await webviewPage.keyboard.press('Enter');

    // Verify status dialog is visible
    await expect(webviewPage.getByText('状态信息', { exact: true })).toBeVisible();

    // Simulate extension sending status response
    await webviewPage.evaluate(() => {
      window.simulateExtensionMessage({
        command: 'statusResponse',
        version: '0.4.15',
        sessionId: 'test-session-123',
        workdir: '/home/user/project',
        configurationData: {
          model: 'gpt-4',
          fastModel: 'gpt-4-mini',
          baseURL: 'https://api.example.com/v1',
          serverUrl: 'https://wave.example.com'
        }
      });
    });

    // Verify status info is displayed
    await expect(webviewPage.getByText('0.4.15')).toBeVisible();
    await expect(webviewPage.getByText('test-session-123')).toBeVisible();
    await expect(webviewPage.getByText('/home/user/project')).toBeVisible();

    // Verify getStatus message was sent to extension
    const messages = await webviewPage.evaluate(() => window.getTestMessages());
    expect(messages.some((m: Record<string, unknown>) => m.command === 'getStatus')).toBe(true);
  });

  test('should open login dialog when /login is typed and Enter pressed', async ({ webviewPage }) => {
    const input = webviewPage.getByTestId('message-input');
    await input.focus();

    // Simulate extension sending configuration data with serverUrl
    await webviewPage.evaluate(() => {
      window.simulateExtensionMessage({
        command: 'configurationResponse',
        configurationData: {
          serverUrl: 'https://wave.example.com'
        }
      });
    });

    // Type /login and press Enter
    await input.type('/login');
    await webviewPage.keyboard.press('Enter');

    // Verify login dialog is visible
    await expect(webviewPage.getByText('SSO 认证', { exact: true })).toBeVisible();

    // Verify server URL input is pre-filled
    const serverUrlInput = webviewPage.locator('#login-serverUrl');
    await expect(serverUrlInput).toHaveValue('https://wave.example.com');

    // Verify getAuthStatus message was sent to extension
    const messages = await webviewPage.evaluate(() => window.getTestMessages());
    expect(messages.some((m: Record<string, unknown>) => m.command === 'getAuthStatus')).toBe(true);
  });

  test('should close dialog on Escape key', async ({ webviewPage }) => {
    const input = webviewPage.getByTestId('message-input');
    await input.focus();

    // Open model dialog
    await input.type('/model');
    await webviewPage.keyboard.press('Enter');

    await expect(webviewPage.getByText('模型设置', { exact: true })).toBeVisible();

    // Press Escape to close
    await webviewPage.keyboard.press('Escape');

    // Verify dialog is closed
    await expect(webviewPage.getByText('模型设置', { exact: true })).not.toBeVisible();
  });

  test('should save model via setModel message', async ({ webviewPage }) => {
    const input = webviewPage.getByTestId('message-input');
    await input.focus();

    // Simulate extension sending configuration data
    await webviewPage.evaluate(() => {
      window.simulateExtensionMessage({
        command: 'configurationResponse',
        configurationData: {
          model: 'gpt-4',
          fastModel: 'gpt-4-mini'
        }
      });
    });

    // Simulate extension sending configured models list
    await webviewPage.evaluate(() => {
      window.simulateExtensionMessage({
        command: 'configuredModelsResponse',
        models: ['gpt-4', 'gpt-4-mini', 'claude-opus-4']
      });
    });

    // Open model dialog
    await input.type('/model');
    await webviewPage.keyboard.press('Enter');

    // Change model via dropdown
    const modelSelect = webviewPage.locator('#model-select');
    await modelSelect.selectOption('claude-opus-4');

    // Click save button
    await webviewPage.getByText('保存', { exact: true }).click();

    // Verify setModel message was sent with correct data
    const messages = await webviewPage.evaluate(() => window.getTestMessages());
    const setModelMsg = messages.find((m: Record<string, unknown>) => m.command === 'setModel');
    expect(setModelMsg).toBeDefined();
    expect((setModelMsg as any).configurationData.model).toBe('claude-opus-4');
    expect((setModelMsg as any).configurationData.fastModel).toBe('gpt-4-mini');
  });

  test('should show login dialog with not-authenticated state', async ({ webviewPage }) => {
    const input = webviewPage.getByTestId('message-input');
    await input.focus();

    // Simulate extension sending configuration data
    await webviewPage.evaluate(() => {
      window.simulateExtensionMessage({
        command: 'configurationResponse',
        configurationData: {
          serverUrl: 'https://wave.example.com'
        }
      });
    });

    // Type /login and press Enter
    await input.type('/login');
    await webviewPage.keyboard.press('Enter');

    // Simulate auth status response (not authenticated)
    await webviewPage.evaluate(() => {
      window.simulateExtensionMessage({
        command: 'authStatusResponse',
        isAuthenticated: false,
        user: null
      });
    });

    // Verify "SSO 登录" button is visible
    await expect(webviewPage.getByText('SSO 登录', { exact: true })).toBeVisible();
  });

  test('should show login dialog with authenticated state', async ({ webviewPage }) => {
    const input = webviewPage.getByTestId('message-input');
    await input.focus();

    // Simulate extension sending configuration data
    await webviewPage.evaluate(() => {
      window.simulateExtensionMessage({
        command: 'configurationResponse',
        configurationData: {
          serverUrl: 'https://wave.example.com'
        }
      });
    });

    // Type /login and press Enter
    await input.type('/login');
    await webviewPage.keyboard.press('Enter');

    // Simulate auth status response (authenticated)
    await webviewPage.evaluate(() => {
      window.simulateExtensionMessage({
        command: 'authStatusResponse',
        isAuthenticated: true,
        user: { id: 'user-123', email: 'test@example.com' }
      });
    });

    // Verify user email and logout button are visible
    await expect(webviewPage.getByText('test@example.com')).toBeVisible();
    await expect(webviewPage.getByText('登出', { exact: true })).toBeVisible();
  });

  test('should save serverUrl from login dialog via updateConfiguration', async ({ webviewPage }) => {
    const input = webviewPage.getByTestId('message-input');
    await input.focus();

    // Simulate extension sending configuration data with empty serverUrl
    await webviewPage.evaluate(() => {
      window.simulateExtensionMessage({
        command: 'configurationResponse',
        configurationData: {
          serverUrl: ''
        }
      });
    });

    // Open login dialog
    await input.type('/login');
    await webviewPage.keyboard.press('Enter');

    // Verify login dialog is visible
    await expect(webviewPage.getByText('SSO 认证', { exact: true })).toBeVisible();

    // Type serverUrl into the input
    const serverUrlInput = webviewPage.locator('#login-serverUrl');
    await serverUrlInput.fill('https://wave.example.com');

    // Click save button for serverUrl
    await webviewPage.locator('#login-save-serverUrl').click();

    // Verify updateConfiguration message was sent with serverUrl
    const messages = await webviewPage.evaluate(() => window.getTestMessages());
    const updateConfigMsg = messages.find((m: Record<string, unknown>) => m.command === 'updateConfiguration');
    expect(updateConfigMsg).toBeDefined();
    expect((updateConfigMsg as any).configurationData.serverUrl).toBe('https://wave.example.com');
  });

  test('should not have serverUrl field in config dialog', async ({ webviewPage }) => {
    const input = webviewPage.getByTestId('message-input');
    await input.focus();

    // Open config dialog
    await input.type('/config');
    await webviewPage.keyboard.press('Enter');

    // Verify config dialog is visible
    await expect(webviewPage.getByText('配置设置', { exact: true })).toBeVisible();

    // Verify serverUrl input is NOT present in config dialog
    const serverUrlInput = webviewPage.locator('#serverUrl');
    await expect(serverUrlInput).not.toBeVisible();
  });
});
