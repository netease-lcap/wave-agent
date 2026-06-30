import { test, expect } from '../utils/webviewTestHarness.js';
import { MessageInjector } from '../utils/messageInjector.js';

test.describe('File Upload Feature', () => {
  test('should show upload option when typing @ without filter text', async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);

    // Clear any existing messages
    await injector.clearMessageLog();

    // Find the message input textarea
    const messageInput = webviewPage.getByTestId('message-input');
    await expect(messageInput).toBeVisible();

    // Type @ symbol to trigger file suggestions
    await messageInput.fill('@');
    await messageInput.press('End');

    // Wait for the requestFileSuggestions request to be sent
    const reqId1 = await injector.waitForFileSuggestionRequest();

    // Simulate response with no filter text
    await injector.simulateExtensionMessage('fileSuggestionsResponse', {
      suggestions: [
        {
          path: '/workspace/src/test.tsx',
          relativePath: 'src/test.tsx',
          name: 'test.tsx',
          extension: 'tsx',
          icon: 'codicon-file',
          isDirectory: false
        }
      ],
      filterText: '', // Empty filter text
      requestId: reqId1
    });

    // Check for suggestion items
    const suggestionItems = webviewPage.locator('.suggestion-item');
    await expect(suggestionItems.first()).toBeVisible();
    const itemCount = await suggestionItems.count();

    // Should have upload option + 1 file = 2 items
    expect(itemCount).toBe(2);

    // Verify the first item is the upload option
    const uploadOption = suggestionItems.first();
    await expect(uploadOption).toContainText('上传本地文件');
    await expect(uploadOption).toHaveClass(/upload-option/);

    // Verify upload option has correct icon
    const uploadIcon = uploadOption.locator('.codicon-cloud-upload');
    await expect(uploadIcon).toBeVisible();
  });

  test('should hide upload option when typing @ with filter text', async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);

    // Clear any existing messages
    await injector.clearMessageLog();

    // Find the message input textarea
    const messageInput = webviewPage.getByTestId('message-input');
    await expect(messageInput).toBeVisible();

    // Type @test to filter
    await messageInput.fill('@test');
    await messageInput.press('End');

    // Wait for the debounced requestFileSuggestions request
    const reqId = await injector.waitForFileSuggestionRequest();

    // Mock filtered response with filter text
    await injector.simulateExtensionMessage('fileSuggestionsResponse', {
      suggestions: [
        {
          path: '/workspace/src/test.tsx',
          relativePath: 'src/test.tsx',
          name: 'test.tsx',
          extension: 'tsx',
          icon: 'codicon-file',
          isDirectory: false
        }
      ],
      filterText: 'test', // Has filter text
      requestId: reqId
    });

    // Should only show filtered results (no upload option when there's filter text)
    const suggestionItems = webviewPage.locator('.suggestion-item');
    await expect(suggestionItems.first()).toBeVisible();
    const itemCount = await suggestionItems.count();
    expect(itemCount).toBe(1);

    // Verify there's no upload option
    const uploadOption = webviewPage.locator('.suggestion-item.upload-option');
    await expect(uploadOption).not.toBeVisible();

    // Verify the suggestion is the filtered file
    const firstSuggestion = suggestionItems.first();
    await expect(firstSuggestion).toContainText('test.tsx');
  });

  test('should handle upload option selection', async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);

    // Clear any existing messages
    await injector.clearMessageLog();

    // Find the message input textarea
    const messageInput = webviewPage.getByTestId('message-input');
    await expect(messageInput).toBeVisible();

    // Type @ symbol to trigger file suggestions
    await messageInput.fill('@');
    await messageInput.press('End');

    // Wait for the debounced requestFileSuggestions request
    const reqId = await injector.waitForFileSuggestionRequest();

    // Simulate response with no filter text to show upload option
    await injector.simulateExtensionMessage('fileSuggestionsResponse', {
      suggestions: [],
      filterText: '', // Empty filter text
      requestId: reqId
    });

    // Find and click the upload option
    const uploadOption = webviewPage.locator('.suggestion-item.upload-option');
    await expect(uploadOption).toBeVisible();

    // Note: We can't actually test file selection dialog in headless browser,
    // but we can verify the upload option is clickable and properly structured
    await expect(uploadOption).toContainText('上传本地文件');
    await expect(uploadOption).toContainText('选择本地文件上传到临时目录');
  });

  test('should insert file paths into input after successful upload', async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);

    // Clear any existing messages
    await injector.clearMessageLog();

    // Find the message input textarea
    const messageInput = webviewPage.getByTestId('message-input');
    await expect(messageInput).toBeVisible();

    // Type @ symbol to trigger file suggestions (this establishes the @ mention context)
    await messageInput.fill('@');
    await messageInput.press('End');

    // Wait for file suggestion request, then simulate upload
    await injector.waitForFileSuggestionRequest();

    // Simulate successful file upload response
    await injector.simulateExtensionMessage('uploadSuccess', {
      uploadedFiles: [
        '/tmp/wave-artifacts/document.pdf',
        '/tmp/wave-artifacts/image.png'
      ],
      message: '成功上传 2 个文件到临时目录'
    });

    // Verify that file paths are inserted into the input as tags
    await expect(messageInput.locator('.context-tag')).toHaveCount(2);
    const inputValue = (await messageInput.innerText()).replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
    expect(inputValue).toBe('@ document.pdf @ image.png');
  });

  test('should handle single file upload path insertion', async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);

    // Clear any existing messages
    await injector.clearMessageLog();

    // Find the message input textarea
    const messageInput = webviewPage.getByTestId('message-input');
    await expect(messageInput).toBeVisible();

    // Type @ symbol to trigger file suggestions
    await messageInput.fill('@');
    await messageInput.press('End');

    await injector.waitForFileSuggestionRequest();

    // Simulate successful single file upload response
    await injector.simulateExtensionMessage('uploadSuccess', {
      uploadedFiles: [
        '/tmp/wave-artifacts/single-file.txt'
      ],
      message: '成功上传 1 个文件到临时目录'
    });

    // Verify that single file path is inserted into the input as a tag
    await expect(messageInput.locator('.context-tag')).toHaveCount(1);
    const inputValue = (await messageInput.innerText()).replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
    expect(inputValue).toBe('@ single-file.txt');
  });

  test('should insert file path correctly in basic scenario', async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);

    // Clear any existing messages  
    await injector.clearMessageLog();

    // Find the message input textarea
    const messageInput = webviewPage.getByTestId('message-input');
    await expect(messageInput).toBeVisible();

    // Simple scenario: just type @ and upload
    await messageInput.type('@');

    await injector.waitForFileSuggestionRequest();

    // Simulate successful file upload response
    await injector.simulateExtensionMessage('uploadSuccess', {
      uploadedFiles: [
        '/tmp/wave-artifacts/test.pdf'
      ],
      message: '成功上传 1 个文件到临时目录'
    });

    // Verify that file path replaces the @ symbol correctly as a tag
    await expect(messageInput.locator('.context-tag')).toHaveCount(1);
    const inputValue = (await messageInput.innerText()).replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
    expect(inputValue).toBe('@ test.pdf');
  });

  test('should not add extra @ symbol when inserting file paths', async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);

    // Clear any existing messages  
    await injector.clearMessageLog();

    // Find the message input textarea
    const messageInput = webviewPage.getByTestId('message-input');
    await expect(messageInput).toBeVisible();

    // Type @ and some filter text
    await messageInput.type('@test');

    await injector.waitForFileSuggestionRequest();

    // Simulate successful file upload response
    await injector.simulateExtensionMessage('uploadSuccess', {
      uploadedFiles: [
        '/tmp/wave-artifacts/uploaded-file.txt'
      ],
      message: '成功上传 1 个文件到临时目录'
    });

    // Verify that file path replaces filter text correctly and doesn't add extra @
    await expect(messageInput.locator('.context-tag')).toHaveCount(1);
    const inputValue = (await messageInput.innerText()).replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
    expect(inputValue).toBe('@ uploaded-file.txt');
  });

});