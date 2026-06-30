import { test, expect } from '../utils/webviewTestHarness.js';
import { MessageInjector } from '../utils/messageInjector.js';

test.describe('Permission Mode Cycle', () => {
  test('should cycle through modes using Shift+Tab', async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    await injector.clearMessageLog();

    // 1. Initial state: Default mode
    await injector.simulateExtensionMessage('setInitialState', {
      messages: [],
      permissionMode: 'default',
      configurationData: {}
    });

    const input = webviewPage.locator('#messageInput');
    const select = webviewPage.locator('.permission-mode-select');
    await expect(input).toBeVisible();
    await expect(select).toHaveValue('default');

    // 2. Set up listener for vscode message
    const sentMessages: Record<string, unknown>[] = [];
    await webviewPage.exposeFunction('capturePermissionMessage', (message: Record<string, unknown>) => {
      if (message.command === 'setPermissionMode') {
        sentMessages.push(message);
      }
    });
    await webviewPage.evaluate(() => {
      window.addEventListener('vscode-message', (event: CustomEvent) => {
        window.capturePermissionMessage(event.detail);
      });
    });

    // 3. Focus input and press Shift+Tab
    await input.focus();
    await webviewPage.keyboard.down('Shift');
    await webviewPage.keyboard.press('Tab');
    await webviewPage.keyboard.up('Shift');

    // 4. Verify message sent to extension (should be acceptEdits)
    await expect(async () => {
      expect(sentMessages.length).toBe(1);
      expect(sentMessages[0]).toEqual({
        command: 'setPermissionMode',
        mode: 'acceptEdits'
      });
    }).toPass();

    // 5. Simulate extension response for acceptEdits
    await injector.simulateExtensionMessage('setInitialState', {
      messages: [],
      permissionMode: 'acceptEdits',
      configurationData: {}
    });
    await expect(select).toHaveValue('acceptEdits');

    // 6. Press Shift+Tab again
    await webviewPage.keyboard.down('Shift');
    await webviewPage.keyboard.press('Tab');
    await webviewPage.keyboard.up('Shift');

    // 7. Verify message sent to extension (should be bypassPermissions)
    await expect(async () => {
      expect(sentMessages.length).toBe(2);
      expect(sentMessages[1]).toEqual({
        command: 'setPermissionMode',
        mode: 'bypassPermissions'
      });
    }).toPass();

    // 8. Simulate extension response for bypassPermissions
    await injector.simulateExtensionMessage('setInitialState', {
      messages: [],
      permissionMode: 'bypassPermissions',
      configurationData: {}
    });
    await expect(select).toHaveValue('bypassPermissions');

    // 9. Press Shift+Tab again
    await webviewPage.keyboard.down('Shift');
    await webviewPage.keyboard.press('Tab');
    await webviewPage.keyboard.up('Shift');

    // 10. Verify message sent to extension (should be plan)
    await expect(async () => {
      expect(sentMessages.length).toBe(3);
      expect(sentMessages[2]).toEqual({
        command: 'setPermissionMode',
        mode: 'plan'
      });
    }).toPass();

    // 11. Simulate extension response for plan
    await injector.simulateExtensionMessage('setInitialState', {
      messages: [],
      permissionMode: 'plan',
      configurationData: {}
    });
    await expect(select).toHaveValue('plan');

    // 12. Press Shift+Tab again
    await webviewPage.keyboard.down('Shift');
    await webviewPage.keyboard.press('Tab');
    await webviewPage.keyboard.up('Shift');

    // 13. Verify message sent to extension (should cycle back to default)
    await expect(async () => {
      expect(sentMessages.length).toBe(4);
      expect(sentMessages[3]).toEqual({
        command: 'setPermissionMode',
        mode: 'default'
      });
    }).toPass();
  });
});
