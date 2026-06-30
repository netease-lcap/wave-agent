/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect } from '../utils/webviewTestHarness.js';

test.describe('Slash Commands Edge Cases', () => {
  test('should use regular spaces after slash command and file mentions when sending', async ({ webviewPage }) => {
    const input = webviewPage.getByTestId('message-input');
    const sendButton = webviewPage.getByTestId('send-btn');
    await input.focus();

    // Simulate selecting a slash command followed by a file mention tag.
    await webviewPage.evaluate(() => {
      const el = document.getElementById('messageInput') as HTMLDivElement;
      if (!el) return;

      const tagSpan = document.createElement('span');
      tagSpan.className = 'context-tag-container';
      tagSpan.contentEditable = 'false';
      tagSpan.setAttribute('data-path', 'src/test.md');
      tagSpan.setAttribute('data-name', 'test.md');
      tagSpan.setAttribute('data-is-image', 'false');
      tagSpan.innerText = '[@file:src/test.md]';

      // Build: "/speckit" + space + file tag
      el.textContent = '';
      el.appendChild(document.createTextNode('/speckit '));
      el.appendChild(tagSpan);

      el.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // Verify the raw contenteditable has a regular space
    const rawContent = await input.evaluate(el => el.textContent);
    expect(rawContent).toContain('/speckit ');
    expect(rawContent).not.toContain('\u00A0');

    // Clear any previously sent messages
    await webviewPage.evaluate(() => {
      (window as any).clearTestMessages();
    });

    // Click send
    await sendButton.click();

    // Verify the sendMessage payload is correctly formatted
    const messages = await webviewPage.evaluate(() => {
      return (window as any).getTestMessages();
    });

    const sendMessage = messages.find((m: any) => m.command === 'sendMessage');
    expect(sendMessage).toBeDefined();
    expect(sendMessage.text).toContain('/speckit ');
    expect(sendMessage.text).toContain('[@file:src/test.md]');
  });

  test('should only trigger slash commands at valid positions', async ({ webviewPage }) => {
    const input = webviewPage.getByTestId('message-input');
    await input.focus();

    // 1. Type a word and then '/' immediately after it (no space)
    await input.type('word/');
    
    // 2. Verify popup is NOT visible
    const popup = webviewPage.getByTestId('slash-commands-popup');
    await expect(popup).not.toBeVisible();

    // 3. Type a space and then '/'
    await input.type(' /');
    
    // 4. Simulate response
    await webviewPage.evaluate(() => {
      (window as any).simulateExtensionMessage({
        command: 'slashCommandsResponse',
        commands: [
          { id: 'help', name: 'help', description: 'Show help' }
        ]
      });
    });

    // 5. Verify popup IS visible
    await expect(popup).toBeVisible();
  });

  test('should allow navigating and selecting commands with keyboard', async ({ webviewPage }) => {
    const input = webviewPage.getByTestId('message-input');
    await input.focus();

    await input.type('/');
    
    // Simulate response with multiple commands
    await webviewPage.evaluate(() => {
      (window as any).simulateExtensionMessage({
        command: 'slashCommandsResponse',
        commands: [
          { id: 'cmd1', name: 'cmd1', description: 'Command 1' },
          { id: 'cmd2', name: 'cmd2', description: 'Command 2' }
        ]
      });
    });

    const popup = webviewPage.getByTestId('slash-commands-popup');
    await expect(popup).toBeVisible();

    // Verify first command is selected by default
    const items = popup.locator('.slash-command-item');
    await expect(items.nth(0)).toHaveClass(/selected/);

    // Press ArrowDown to select second command
    await webviewPage.keyboard.press('ArrowDown');
    await expect(items.nth(1)).toHaveClass(/selected/);
    await expect(items.nth(0)).not.toHaveClass(/selected/);

    // Press Enter to select
    await webviewPage.keyboard.press('Enter');
    
    // Verify content
    const content = await input.innerText();
    expect(content.trim()).toBe('/cmd2');
  });

  test('should close popup on Escape', async ({ webviewPage }) => {
    const input = webviewPage.getByTestId('message-input');
    await input.focus();

    await input.type('/');
    
    await webviewPage.evaluate(() => {
      (window as any).simulateExtensionMessage({
        command: 'slashCommandsResponse',
        commands: [{ id: 'help', name: 'help', description: 'Show help' }]
      });
    });

    const popup = webviewPage.getByTestId('slash-commands-popup');
    await expect(popup).toBeVisible();

    // Press Escape
    await webviewPage.keyboard.press('Escape');
    
    // Verify popup is closed
    await expect(popup).not.toBeVisible();
    
    // Verify '/' is still in input
    const content = await input.innerText();
    expect(content.trim()).toBe('/');
  });

  test('should handle multiple slash commands in one message', async ({ webviewPage }) => {
    const input = webviewPage.getByTestId('message-input');
    await input.focus();

    const popup = webviewPage.getByTestId('slash-commands-popup');

    // First command
    await input.press('/');
    await webviewPage.evaluate(() => {
      (window as any).simulateExtensionMessage({
        command: 'slashCommandsResponse',
        commands: [{ id: 'cmd1', name: 'cmd1', description: 'Command 1' }]
      });
    });
    await expect(popup).toBeVisible();
    await webviewPage.keyboard.press('Enter');
    await expect(popup).not.toBeVisible();

    // Second command
    await input.press('/');
    await webviewPage.evaluate(() => {
      (window as any).simulateExtensionMessage({
        command: 'slashCommandsResponse',
        commands: [{ id: 'cmd2', name: 'cmd2', description: 'Command 2' }]
      });
    });
    await expect(popup).toBeVisible();
    await webviewPage.keyboard.press('Enter');
    await expect(popup).not.toBeVisible();

    // Verify content
    await expect(async () => {
      const content = await input.innerText();
      expect(content.replace(/\u00A0/g, ' ').trim()).toBe('/cmd1 /cmd2');
    }).toPass();
  });
});
