/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect } from '../utils/webviewTestHarness.js';
import { MessageInjector } from '../utils/messageInjector.js';

test.describe('Tag Vertical Spacing', () => {
  test('should have vertical spacing between tags on different lines in the input box', async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    await injector.clearMessageLog();

    const messageInput = webviewPage.getByTestId('message-input');
    await messageInput.focus();

    // Set up listener for requestId
    await webviewPage.evaluate(() => {
      window.addEventListener('vscode-message', ((event: CustomEvent) => {
        if (event.detail.command === 'requestFileSuggestions') {
          (window as any).lastRequestId = event.detail.requestId;
        }
      }) as EventListener);
    });

    // Helper to insert a tag
    const insertTag = async (name: string, path: string) => {
      // Clear lastRequestId
      await webviewPage.evaluate(() => {
        (window as unknown as Record<string, unknown>).lastRequestId = undefined;
      });

      await webviewPage.keyboard.type('@f');

      // Wait for the requestFileSuggestions request
      const requestId = await injector.waitForFileSuggestionRequest();

      await injector.simulateExtensionMessage('fileSuggestionsResponse', {
        suggestions: [
          {
            path: path,
            relativePath: path,
            name: name,
            extension: 'tsx',
            icon: 'codicon-file',
            isDirectory: false
          }
        ],
        filterText: 'f',
        requestId: requestId || 'test-id'
      });
      
      // Wait for dropdown to be visible
      await webviewPage.waitForSelector('.file-suggestion-dropdown', { state: 'visible' });
      await webviewPage.waitForSelector('.suggestion-item', { state: 'visible' });
      
      // Press Enter to select the suggestion
      await webviewPage.keyboard.press('Enter');
      
      // Wait for dropdown to disappear
      await webviewPage.waitForSelector('.file-suggestion-dropdown', { state: 'hidden' });
    };

    // Insert first tag
    await insertTag('file1.ts', 'file1.ts');
    
    // Insert newline
    await webviewPage.keyboard.down('Shift');
    await webviewPage.keyboard.press('Enter');
    await webviewPage.keyboard.up('Shift');

    // Insert second tag
    await insertTag('file2.ts', 'file2.ts');

    // Get bounding boxes
    const tags = messageInput.locator('.context-tag-container');
    await expect(tags).toHaveCount(2);
    
    const box1 = await tags.nth(0).boundingBox();
    const box2 = await tags.nth(1).boundingBox();
    
    expect(box1).not.toBeNull();
    expect(box2).not.toBeNull();
    
    if (box1 && box2) {
      const gap = box2.y - (box1.y + box1.height);

      // Expect at least 4px gap (2px margin-bottom of tag1 + 2px margin-top of tag2)
      expect(gap).toBeGreaterThanOrEqual(4);
    }
  });

  test('should have vertical spacing between tags on different lines in the message list', async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    await injector.clearMessageLog();

    // Send a message with two tags on separate lines
    await injector.simulateExtensionMessage('updateMessages', {
      messages: [
        {
          role: 'user',
          content: '[@file:file1.ts]\n[@file:file2.ts]',
          id: 'msg-1',
          blocks: [
            {
              type: 'text',
              content: '[@file:file1.ts]\n[@file:file2.ts]'
            }
          ]
        }
      ]
    });

    // Wait for message to render
    const message = webviewPage.locator('.message.user').first();
    await expect(message).toBeVisible();
    
    const tags = message.locator('.context-tag');
    await expect(tags).toHaveCount(2);
    
    const box1 = await tags.nth(0).boundingBox();
    const box2 = await tags.nth(1).boundingBox();
    
    expect(box1).not.toBeNull();
    expect(box2).not.toBeNull();
    
    if (box1 && box2) {
      const gap = box2.y - (box1.y + box1.height);

      // Expect at least 4px gap
      expect(gap).toBeGreaterThanOrEqual(4);
    }
  });
});
