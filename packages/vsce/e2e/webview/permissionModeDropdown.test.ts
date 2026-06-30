import { test, expect } from '../utils/webviewTestHarness.js';
import { MessageInjector } from '../utils/messageInjector.js';

test.describe('Permission Mode Select', () => {
  test('should select a different mode', async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    await injector.clearMessageLog();

    // 1. Initial state: Default mode
    await injector.simulateExtensionMessage('setInitialState', {
      messages: [],
      permissionMode: 'default',
      configurationData: {}
    });

    const select = webviewPage.locator('.permission-mode-select');
    await expect(select).toBeVisible();
    await expect(select).toHaveValue('default');

    // 2. Set up listener for vscode message
    let sentMessage: Record<string, unknown> | null = null;
    await webviewPage.exposeFunction('capturePermissionMessage', (message: Record<string, unknown>) => {
      if (message.command === 'setPermissionMode') {
        sentMessage = message;
      }
    });
    await webviewPage.evaluate(() => {
      window.addEventListener('vscode-message', (event: CustomEvent) => {
        window.capturePermissionMessage(event.detail);
      });
    });

    // 3. Select "自动接受修改" (acceptEdits)
    await select.selectOption('acceptEdits');

    // 4. Verify message sent to extension
    await expect(async () => {
      expect(sentMessage).toEqual({
        command: 'setPermissionMode',
        mode: 'acceptEdits'
      });
    }).toPass();

    // 5. Verify UI update (simulating extension response)
    await injector.simulateExtensionMessage('setInitialState', {
      messages: [],
      permissionMode: 'acceptEdits',
      configurationData: {}
    });
    await expect(select).toHaveValue('acceptEdits');
    await expect(select).toHaveClass(/mode-acceptEdits/);
  });

  test('should include bypassPermissions option in dropdown', async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    await injector.clearMessageLog();

    await injector.simulateExtensionMessage('setInitialState', {
      messages: [],
      permissionMode: 'default',
      configurationData: {}
    });

    const select = webviewPage.locator('.permission-mode-select');
    await expect(select).toBeVisible();

    // Verify bypassPermissions option exists
    const options = await select.locator('option').allTextContents();
    expect(options).toContain('跳过权限确认');

    // Select bypassPermissions
    await select.selectOption('bypassPermissions');

    // Verify UI update
    await injector.simulateExtensionMessage('setInitialState', {
      messages: [],
      permissionMode: 'bypassPermissions',
      configurationData: {}
    });
    await expect(select).toHaveValue('bypassPermissions');
    await expect(select).toHaveClass(/mode-bypassPermissions/);
  });
});
