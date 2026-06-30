import { test, expect } from '../utils/webviewTestHarness.js';
import { MessageInjector } from '../utils/messageInjector.js';

test.describe('File Mention Tag Insertion', () => {
  test('should insert a visual tag when a file is selected from suggestions', async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);

    // Clear any existing messages
    await injector.clearMessageLog();

    // Find the message input
    const messageInput = webviewPage.getByTestId('message-input');
    await expect(messageInput).toBeVisible();

    // Type @ to trigger suggestions
    await messageInput.focus();
    await webviewPage.keyboard.type('@');

    // Wait for the debounced requestFileSuggestions request
    const reqId1 = await injector.waitForFileSuggestionRequest();

    // Use the captured requestId in our response
    await injector.simulateExtensionMessage('fileSuggestionsResponse', {
      suggestions: [
        {
          path: '/workspace/src/components/MessageInput.tsx',
          relativePath: 'src/components/MessageInput.tsx',
          name: 'MessageInput.tsx',
          extension: 'tsx',
          icon: 'codicon-file',
          isDirectory: false
        }
      ],
      filterText: '',
      requestId: reqId1
    });

    // Wait for suggestions to render
    await webviewPage.waitForSelector('.file-suggestion-dropdown', { state: 'visible' });

    // Type something to filter and select the first file suggestion
    const countBeforeMess = await injector.getMessageCount();
    await webviewPage.keyboard.type('Mess');
    const reqId2 = await injector.waitForFileSuggestionRequest(2000, countBeforeMess);

    await injector.simulateExtensionMessage('fileSuggestionsResponse', {
      suggestions: [
        {
          path: '/workspace/src/components/MessageInput.tsx',
          relativePath: 'src/components/MessageInput.tsx',
          name: 'MessageInput.tsx',
          extension: 'tsx',
          icon: 'codicon-file',
          isDirectory: false
        }
      ],
      filterText: 'Mess',
      requestId: reqId2
    });
    
    await webviewPage.waitForSelector('.suggestion-item:not(.upload-option)', { state: 'visible' });

    // Press Enter to select the suggestion
    await webviewPage.keyboard.press('Enter');

    // Check if the tag is inserted into the contenteditable area
    const tag = messageInput.locator('.context-tag');
    await expect(tag).toBeVisible();
    await expect(tag).toContainText('MessageInput.tsx');
    await expect(tag).toContainText('@');

    // Check if a space was inserted after the tag
    const innerText = await messageInput.innerText();
    expect(innerText.replace(/\n/g, '')).toMatch(/@MessageInput.tsx\s/);
  });

  test('should insert an image tag and show preview on click', async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    await injector.clearMessageLog();

    const messageInput = webviewPage.getByTestId('message-input');
    
    // Type @ to trigger suggestions
    await messageInput.focus();
    await webviewPage.keyboard.type('@');
    await injector.waitForFileSuggestionRequest();

    // Type img to filter
    const countBeforeImg = await injector.getMessageCount();
    await webviewPage.keyboard.type('img');
    const reqId2 = await injector.waitForFileSuggestionRequest(2000, countBeforeImg);

    // Mock image file suggestion
    await injector.simulateExtensionMessage('fileSuggestionsResponse', {
      suggestions: [
        {
          path: '/workspace/images/test.png',
          relativePath: 'images/test.png',
          name: 'test.png',
          extension: 'png',
          icon: 'codicon-file-media',
          isDirectory: false
        }
      ],
      filterText: 'img',
      requestId: reqId2
    });

    await webviewPage.waitForSelector('.suggestion-item:not(.upload-option)', { state: 'visible' });
    
    // Use keyboard to select
    await webviewPage.keyboard.press('Enter');

    // Check if image tag is inserted
    const tag = messageInput.locator('.context-tag.is-image');
    await expect(tag).toBeVisible();

    // Click the tag to trigger preview
    let previewMessageSent = false;
    await webviewPage.exposeFunction('capturePreviewMessage', (message: Record<string, unknown>) => {
      if (message.command === 'previewImage' && message.path === '/workspace/images/test.png') {
        previewMessageSent = true;
      }
    });

    await webviewPage.evaluate(() => {
      window.addEventListener('vscode-message', (event: CustomEvent) => {
        (window as unknown as {capturePreviewMessage: (msg: Record<string, unknown>) => void}).capturePreviewMessage(event.detail);
      });
    });

    await tag.click();

    // Wait for the preview message to be sent
    await expect(async () => {
      expect(previewMessageSent).toBe(true);
    }).toPass();
  });

  test('should insert a tag for pasted image and show preview modal', async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    await injector.clearMessageLog();

    const messageInput = webviewPage.getByTestId('message-input');
    await messageInput.focus();

    // Simulate paste event with an image
    await webviewPage.evaluate(() => {
      const dataTransfer = new DataTransfer();
      const file = new File([''], 'pasted-image.png', { type: 'image/png' });
      dataTransfer.items.add(file);
      
      const event = new ClipboardEvent('paste', {
        clipboardData: dataTransfer,
        bubbles: true,
        cancelable: true
      });
      
      document.getElementById('messageInput')?.dispatchEvent(event);
    });

    // Check if image tag is inserted
    const tag = messageInput.locator('.context-tag.is-image');
    await expect(tag).toBeVisible();
    await expect(tag).toContainText('图片 1');

    // Click the tag to trigger preview modal
    await tag.click();

    // Check if preview modal is visible
    const modal = webviewPage.locator('.image-preview-modal');
    await expect(modal).toBeVisible();

    // Check if image is inside modal
    const modalImg = modal.locator('img');
    await expect(modalImg).toBeVisible();

    // Click close button to close it
    const closeBtn = modal.locator('.image-preview-close');
    await closeBtn.click();
    await expect(modal).not.toBeVisible();
  });
});
