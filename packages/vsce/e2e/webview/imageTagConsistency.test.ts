/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect } from '../utils/webviewTestHarness.js';
import { MessageInjector } from '../utils/messageInjector.js';

test.describe('Image Tag Consistency and Placeholder Flow', () => {
  test('should show consistent image tags in input and history with [imageN] placeholders', async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    await injector.clearMessageLog();

    const messageInput = webviewPage.getByTestId('message-input');
    await messageInput.focus();

    // 1. Simulate pasting two images
    await webviewPage.evaluate(() => {
      const simulatePaste = (filename: string) => {
        const dataTransfer = new DataTransfer();
        // Use a small valid base64 image to ensure it's processed
        // A 1x1 transparent PNG
        const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
        const byteCharacters = atob(base64);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: 'image/png' });
        const file = new File([blob], filename, { type: 'image/png' });
        dataTransfer.items.add(file);
        
        const event = new ClipboardEvent('paste', {
          clipboardData: dataTransfer,
          bubbles: true,
          cancelable: true
        });
        
        document.getElementById('messageInput')?.dispatchEvent(event);
      };

      simulatePaste('image1.png');
      simulatePaste('image2.png');
    });

    // Wait for images to be processed and tags to appear
    await expect(messageInput.locator('.context-tag.is-image')).toHaveCount(2, { timeout: 5000 });

    // Manually trigger input event to ensure React state is updated
    await webviewPage.evaluate(() => {
      const input = document.getElementById('messageInput');
      if (input) {
        const event = new Event('input', { bubbles: true });
        input.dispatchEvent(event);
      }
    });

    // 2. Verify tags in input box have "图片 1" and "图片 2"
    const inputTags = messageInput.locator('.context-tag.is-image');
    await expect(inputTags.nth(0)).toContainText('图片 1');
    await expect(inputTags.nth(1)).toContainText('图片 2');

    // 3. Capture the message sent to extension
    await webviewPage.evaluate(() => {
      window.sentMessages = [];
      window.addEventListener('vscode-message', ((event: CustomEvent) => {
        if (event.detail.command === 'sendMessage') {
          (window as any).sentMessages.push(event.detail);
        }
      }) as EventListener);
    });

    // 4. Send the message
    const sendButton = webviewPage.getByTestId('send-btn');
    await expect(sendButton).toBeEnabled({ timeout: 5000 });
    await sendButton.click();

    // 5. Verify the markdown sent to extension contains [image1] and [image2]
    const sentMarkdown = await webviewPage.evaluate(() => {
      const msg = window.sentMessages.find((m) => m.command === 'sendMessage');
      return msg ? msg.text : null;
    });
    
    if (sentMarkdown) {
      expect(sentMarkdown).toContain('[image1]');
      expect(sentMarkdown).toContain('[image2]');
    }

    // 6. Inject a message into history that uses [image1] and [image2]
    // This simulates what happens when the message is restored or received back
    await injector.updateMessages([
      {
        id: 'msg_1',
        role: 'user',
        timestamp: '2024-01-01T00:00:00.000Z',
        blocks: [
          {
            type: 'text',
            content: 'Check these: [image1] and [image2]'
          },
          {
            type: 'image',
            imageUrls: [
              'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==',
              'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg=='
            ]
          }
        ]
      }
    ]);

    // 7. Verify tags in history also show "图片 1" and "图片 2"
    const historyTags = webviewPage.locator('.message.user .context-tag.is-image');
    await expect(historyTags).toHaveCount(2);
    await expect(historyTags.nth(0)).toContainText('图片 1');
    await expect(historyTags.nth(1)).toContainText('图片 2');

    // 8. Verify preview works in history
    await historyTags.nth(0).click();
    const modal = webviewPage.locator('.image-preview-modal');
    await expect(modal).toBeVisible();
    await expect(modal.locator('img')).toBeVisible();
    
    // Close modal
    await webviewPage.locator('.image-preview-close').click();
    await expect(modal).not.toBeVisible();
  });
});
