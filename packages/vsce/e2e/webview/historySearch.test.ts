import { test, expect } from '../utils/webviewTestHarness.js';
import { MessageInjector } from '../utils/messageInjector.js';

test.describe('History Search Feature', () => {
  test('should open history search popup on Ctrl+R and select a prompt', async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    await injector.clearMessageLog();

    const messageInput = webviewPage.getByTestId('message-input');
    await messageInput.focus();

    // 1. Press Ctrl+R
    await webviewPage.keyboard.press('Control+r');

    // 2. Verify popup is visible
    const popup = webviewPage.getByTestId('history-search-popup');
    await expect(popup).toBeVisible();

    // 3. Simulate history response from extension
    const mockHistory = [
      { prompt: 'First prompt', timestamp: Date.now() - 10000 },
      { prompt: 'Second prompt', timestamp: Date.now() - 5000 },
      { prompt: 'Third prompt', timestamp: Date.now() }
    ];

    await injector.simulateExtensionMessage('historyResponse', {
      history: mockHistory
    });

    // 4. Verify history items are displayed
    const items = webviewPage.locator('.history-search-item');
    await expect(items).toHaveCount(3);
    await expect(items.nth(0)).toContainText('First prompt');

    // 5. Navigate and select
    await webviewPage.keyboard.press('ArrowDown');
    await webviewPage.keyboard.press('Enter');

    // 6. Verify popup is closed and input is populated
    await expect(popup).not.toBeVisible();
    // Verify focus is returned to message input
    await expect(messageInput).toBeFocused();
    // In contenteditable, we check innerText
    const inputValue = await messageInput.innerText();
    expect(inputValue.trim()).toBe('Second prompt');
  });

  test('should filter history results as user types', async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    await injector.clearMessageLog();

    const messageInput = webviewPage.getByTestId('message-input');
    await messageInput.focus();

    // 1. Press Ctrl+R
    await webviewPage.keyboard.press('Control+r');

    // 2. Type in search box
    const searchInput = webviewPage.locator('.history-search-input');
    await searchInput.type('test');

    // 3. Verify searchHistory command was sent to extension
    // We can't easily verify outgoing messages in this harness without exposing a function,
    // but we can simulate the response.
    
    const filteredHistory = [
      { prompt: 'test prompt 1', timestamp: Date.now() - 1000 },
      { prompt: 'another test', timestamp: Date.now() }
    ];

    await injector.simulateExtensionMessage('historyResponse', {
      history: filteredHistory
    });

    // 4. Verify filtered items
    const items = webviewPage.locator('.history-search-item');
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toContainText('test prompt 1');
  });

  test('should close history search popup on Escape', async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    await injector.clearMessageLog();

    const messageInput = webviewPage.getByTestId('message-input');
    await messageInput.focus();

    // 1. Press Ctrl+R
    await webviewPage.keyboard.press('Control+r');
    const popup = webviewPage.getByTestId('history-search-popup');
    await expect(popup).toBeVisible();

    // 2. Press Escape
    await webviewPage.keyboard.press('Escape');

    // 3. Verify popup is closed
    await expect(popup).not.toBeVisible();

    // 4. Verify focus is returned to message input
    await expect(messageInput).toBeFocused();
  });

  test('should return focus to message input after closing history search by clicking outside', async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    await injector.clearMessageLog();

    const messageInput = webviewPage.getByTestId('message-input');
    await messageInput.focus();
    await expect(messageInput).toBeFocused();

    // 1. Press Ctrl+R to open history search
    await webviewPage.keyboard.press('Control+r');
    const popup = webviewPage.getByTestId('history-search-popup');
    await expect(popup).toBeVisible();

    // 2. Click outside the popup (e.g., on the message list)
    await webviewPage.getByTestId('messages-container').click();

    // 3. Verify popup is closed
    await expect(popup).not.toBeVisible();

    // 4. Verify focus is returned to message input
    await expect(messageInput).toBeFocused();
  });
});
