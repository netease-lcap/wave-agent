import { test, expect } from '../utils/webviewTestHarness.js';
import { MessageInjector } from '../utils/messageInjector.js';

test.describe('File Mention Feature (@)', () => {
  test('should show file suggestion dropdown when typing @', async ({ webviewPage }) => {
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

    // Use the captured requestId in our response
    await injector.simulateExtensionMessage('fileSuggestionsResponse', {
      suggestions: [
        {
          path: '/workspace/src',
          relativePath: 'src',
          name: 'src',
          extension: '',
          icon: 'codicon-folder',
          isDirectory: true
        },
        {
          path: '/workspace/src/components/MessageInput.tsx',
          relativePath: 'src/components/MessageInput.tsx',
          name: 'MessageInput.tsx',
          extension: 'tsx',
          icon: 'codicon-file',
          isDirectory: false
        },
        {
          path: '/workspace/src/components/ChatApp.tsx',
          relativePath: 'src/components/ChatApp.tsx',
          name: 'ChatApp.tsx',
          extension: 'tsx',
          icon: 'codicon-file',
          isDirectory: false
        }
      ],
      filterText: '',
      requestId: reqId
    });

    // Wait for suggestions to render
    await webviewPage.waitForSelector('.suggestion-item', { state: 'visible' });

    // Check if file suggestion dropdown is present
    const dropdown = webviewPage.locator('.file-suggestion-dropdown');
    const isDropdownVisible = await dropdown.isVisible();

    // Check dropdown positioning
    if (isDropdownVisible) {
      const dropdownBox = await dropdown.boundingBox();
      const inputBox = await messageInput.boundingBox();



      // Verify dropdown is positioned correctly relative to input
      if (dropdownBox && inputBox) {
        // Simple check: dropdown should be above input (visual y position less than input y)
        expect(dropdownBox.y).toBeLessThan(inputBox.y);

        // Check horizontal alignment
        expect(Math.abs(dropdownBox.x - inputBox.x)).toBeLessThan(5);
      }
    }

    // Check for suggestion items
    const suggestionItems = webviewPage.locator('.suggestion-item');
    const itemCount = await suggestionItems.count();

    // Expect to see the suggestions we injected (1 folder + 2 files) + 1 upload option = 4
    expect(itemCount).toBe(4);

    // Verify the first item is the upload option when no filter text
    const firstSuggestion = suggestionItems.first();
    await expect(firstSuggestion).toContainText('上传本地文件');
    await expect(firstSuggestion).toHaveClass(/upload-option/);
  });

  test('should filter files as user types after @', async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);

    await injector.clearMessageLog();

    const messageInput = webviewPage.getByTestId('message-input');

    // Type @src to filter
    await messageInput.fill('@src');
    await messageInput.press('End');

    // Wait for the debounced requestFileSuggestions request
    const reqId = await injector.waitForFileSuggestionRequest();

    // Mock filtered response with captured requestId
    await injector.simulateExtensionMessage('fileSuggestionsResponse', {
      suggestions: [
        {
          path: '/workspace/src/components/MessageInput.tsx',
          relativePath: 'src/components/MessageInput.tsx',
          name: 'MessageInput.tsx',
          extension: 'tsx',
          icon: 'codicon-react'
        }
      ],
      filterText: 'src',
      requestId: reqId
    });

    // Should only show filtered results (no upload option when there's filter text)
    const suggestionItems = webviewPage.locator('.suggestion-item');
    await expect(suggestionItems.first()).toBeVisible();
    const itemCount = await suggestionItems.count();
    expect(itemCount).toBe(1);

    // Verify the suggestion text contains the filter
    const firstSuggestion = suggestionItems.first();
    await expect(firstSuggestion).toContainText('src');
  });
});