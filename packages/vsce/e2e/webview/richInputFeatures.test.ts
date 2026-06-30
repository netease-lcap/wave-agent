/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect } from '../utils/webviewTestHarness.js';
import { MessageInjector } from '../utils/messageInjector.js';

test.describe('Rich Input Features', () => {
  test('should handle mixed text and multiple context tags correctly', async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    await injector.clearMessageLog();

    const messageInput = webviewPage.getByTestId('message-input');
    await messageInput.focus();

    // 1. Type some text
    await webviewPage.keyboard.type('Check these files: ');

    // 2. Insert first file tag
    await webviewPage.keyboard.type('@file1');
    const reqId1 = await injector.waitForFileSuggestionRequest();
    await injector.simulateExtensionMessage('fileSuggestionsResponse', {
      suggestions: [{
        path: '/workspace/file1.ts',
        relativePath: 'file1.ts',
        name: 'file1.ts',
        extension: 'ts',
        icon: 'codicon-file',
        isDirectory: false
      }],
      filterText: 'file1',
      requestId: reqId1
    });
    await webviewPage.waitForSelector('.suggestion-item', { state: 'visible' });
    await webviewPage.keyboard.press('Enter');

    // 3. Type more text
    await webviewPage.keyboard.type('and also ');

    // 4. Insert second file tag
    const countBeforeFile2 = await injector.getMessageCount();
    await webviewPage.keyboard.type('@file2');
    const reqId2 = await injector.waitForFileSuggestionRequest(2000, countBeforeFile2);
    await injector.simulateExtensionMessage('fileSuggestionsResponse', {
      suggestions: [{
        path: '/workspace/file2.ts',
        relativePath: 'file2.ts',
        name: 'file2.ts',
        extension: 'ts',
        icon: 'codicon-file',
        isDirectory: false
      }],
      filterText: 'file2',
      requestId: reqId2
    });
    await webviewPage.waitForSelector('.suggestion-item', { state: 'visible' });
    await webviewPage.keyboard.press('Enter');

    // 5. Verify input content
    const tags = messageInput.locator('.context-tag');
    await expect(tags).toHaveCount(2);
    await expect(tags.nth(0)).toContainText('file1.ts');
    await expect(tags.nth(1)).toContainText('file2.ts');

    // 6. Send and verify markdown
    await webviewPage.evaluate(() => {
      (window as any).sentMessages = [];
      window.addEventListener('vscode-message', ((event: CustomEvent) => {
        if (event.detail.command === 'sendMessage') {
          (window as any).sentMessages.push(event.detail);
        }
      }) as EventListener);
    });

    await webviewPage.getByTestId('send-btn').click();

    const sentMarkdown = await webviewPage.evaluate(() => {
      const msg = (window as any).sentMessages.find((m: any) => m.command === 'sendMessage');
      return msg ? msg.text : null;
    });

    // Note: \u00A0 is used for spaces after tags
    expect(sentMarkdown.replace(/\u00A0/g, ' ').trim()).toBe('Check these files: [@file:file1.ts] and also [@file:file2.ts]');
  });

  test('should allow deleting context tags with backspace', async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    await injector.clearMessageLog();

    const messageInput = webviewPage.getByTestId('message-input');
    await messageInput.focus();

    // Insert a tag
    await webviewPage.keyboard.type('@test.ts');
    const reqId = await injector.waitForFileSuggestionRequest();
    await injector.simulateExtensionMessage('fileSuggestionsResponse', {
      suggestions: [{
        path: '/workspace/test.ts',
        relativePath: 'test.ts',
        name: 'test.ts',
        extension: 'ts',
        icon: 'codicon-file',
        isDirectory: false
      }],
      filterText: 'test.ts',
      requestId: reqId
    });
    await webviewPage.waitForSelector('.suggestion-item', { state: 'visible' });
    await webviewPage.keyboard.press('Enter');

    // Verify tag exists
    await expect(messageInput.locator('.context-tag')).toHaveCount(1);

    // Press backspace to delete the space after tag, then the tag itself
    await webviewPage.keyboard.press('Backspace'); // Delete space
    await webviewPage.keyboard.press('Backspace'); // Delete tag

    // Verify tag is gone
    await expect(messageInput.locator('.context-tag')).toHaveCount(0);
  });

  test('should insert inline selection tag and render it in history', async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);
    await injector.clearMessageLog();

    // 1. Simulate "Add to Wave" command from extension
    const selection = {
      filePath: '/workspace/src/app.ts',
      fileName: 'app.ts',
      startLine: 1,
      endLine: 10,
      selectedText: 'console.log("hello");',
      isEmpty: false
    };

    await injector.simulateExtensionMessage('addSelectionToInput', {
      selection: selection
    });

    // 2. Verify inline tag is inserted in the input
    const messageInput = webviewPage.getByTestId('message-input');
    const inlineTag = messageInput.locator('.context-tag-container[data-is-selection="true"]');
    await expect(inlineTag).toBeVisible();
    await expect(inlineTag).toContainText('app.ts#1-10');

    // 3. Type and send
    await messageInput.focus();
    await webviewPage.keyboard.type('Check this: ');

    await webviewPage.evaluate(() => {
      (window as any).sentMessages = [];
      window.addEventListener('vscode-message', ((event: CustomEvent) => {
        if (event.detail.command === 'sendMessage') {
          (window as any).sentMessages.push(event.detail);
        }
      }) as EventListener);
    });

    await webviewPage.getByTestId('send-btn').click();

    const sentMessage = await webviewPage.evaluate(() => {
      return (window as any).sentMessages.find((m: any) => m.command === 'sendMessage');
    });

    // The markdown should contain the selection placeholder
    expect(sentMessage.text).toContain('[Selection: /workspace/src/app.ts|app.ts#1-10]');
    // Selection property should be undefined as it's now inline
    expect(sentMessage.selection).toBeUndefined();
  });
});
