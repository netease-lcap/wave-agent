import { test, expect } from '../utils/webviewTestHarness.js';
import { MessageInjector } from '../utils/messageInjector.js';

test.describe('Tag Clickability', () => {
  test('should not have clickable class for regular file and directory tags in messages', async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    await injector.clearMessageLog();

    // Inject a message with a file tag and a directory tag
    await injector.updateMessages([{
      id: 'msg1',
      role: 'user',
      timestamp: '2024-01-01T00:00:00.000Z',
      blocks: [
        {
          type: 'text',
          content: 'Check this file [@file:/workspace/src/main.ts] and this directory [@file:/workspace/src/].'
        }
      ]
    }]);

    // Wait for the message to render
    const message = webviewPage.locator('.message.user').first();
    await expect(message).toBeVisible();

    // Check the file tag
    const fileTag = message.locator('.context-tag').filter({ hasText: 'main.ts' });
    await expect(fileTag).toBeVisible();
    await expect(fileTag).not.toHaveClass(/clickable/);

    // Check the directory tag
    const dirTag = message.locator('.context-tag').filter({ hasText: 'src' });
    await expect(dirTag).toBeVisible();
    await expect(dirTag).not.toHaveClass(/clickable/);
  });

  test('should have clickable class for image tags in messages', async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    await injector.clearMessageLog();

    // Inject a message with an image tag
    await injector.updateMessages([{
      id: 'msg2',
      role: 'user',
      timestamp: '2024-01-01T00:00:00.000Z',
      blocks: [
        {
          type: 'text',
          content: 'Check this image [@file:/workspace/images/logo.png].'
        }
      ]
    }]);

    // Wait for the message to render
    const message = webviewPage.locator('.message.user').first();
    await expect(message).toBeVisible();

    // Check the image tag
    const imageTag = message.locator('.context-tag.is-image');
    await expect(imageTag).toBeVisible();
    await expect(imageTag).toHaveClass(/clickable/);
  });

  test('should have clickable class for code selection tags in messages', async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    await injector.clearMessageLog();

    // Inject a message with a code selection tag
    await injector.updateMessages([{
      id: 'msg3',
      role: 'user',
      timestamp: '2024-01-01T00:00:00.000Z',
      blocks: [
        {
          type: 'text',
          content: 'Check this selection [Selection: /workspace/src/main.ts|main.ts#10-20].'
        }
      ]
    }]);

    // Wait for the message to render
    const message = webviewPage.locator('.message.user').first();
    await expect(message).toBeVisible();

    // Check the selection tag
    const selectionTag = message.locator('.context-tag').filter({ hasText: 'main.ts#10-20' });
    await expect(selectionTag).toBeVisible();
    await expect(selectionTag).toHaveClass(/clickable/);
  });

  test('should have clickable class for inline image tags (pasted images)', async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    await injector.clearMessageLog();

    // Inject a message with an inline image tag
    await injector.updateMessages([{
      id: 'msg4',
      role: 'user',
      timestamp: '2024-01-01T00:00:00.000Z',
      blocks: [
        {
          type: 'text',
          content: 'Check this pasted image [image1].'
        },
        {
          type: 'image',
          imageUrls: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==']
        }
      ]
    }]);

    // Wait for the message to render
    const message = webviewPage.locator('.message.user').first();
    await expect(message).toBeVisible();

    // Check the inline image tag
    const inlineImageTag = message.locator('.context-tag.is-image');
    await expect(inlineImageTag).toBeVisible();
    await expect(inlineImageTag).toHaveClass(/clickable/);
  });
});
