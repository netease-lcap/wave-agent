import { renderChatApp, screen, waitFor, fireEvent, act, sendCommand } from './test-utils';
import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Helper: type text into the contenteditable message input and set up
 * a selection at the end so that selection-change detection works.
 */
function typeInInput(text: string) {
  const input = screen.getByTestId('message-input');
  input.focus();
  input.textContent = text;

  // Set up selection at end of content
  const selection = window.getSelection();
  if (selection) {
    const range = document.createRange();
    range.selectNodeContents(input);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  fireEvent.input(input);
}

/**
 * Helper: wait for requestFileSuggestions and return the requestId
 */
async function waitForFileSuggestionRequest(vscode: ReturnType<typeof renderChatApp>['vscode']): Promise<string> {
  await waitFor(() => {
    expect(vscode.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'requestFileSuggestions' })
    );
  }, { timeout: 3000 });

  const calls = vscode.postMessage.mock.calls.map(c => c[0]);
  const requestCall = calls.filter(c => c.command === 'requestFileSuggestions').pop();
  return requestCall.requestId;
}

describe('File Mention Feature (@)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should show file suggestion dropdown when typing @', async () => {
    const { vscode } = renderChatApp();

    // Type @ symbol to trigger file suggestions
    act(() => {
      typeInInput('@');
    });

    // Wait for the debounced requestFileSuggestions request
    const reqId = await waitForFileSuggestionRequest(vscode);

    // Simulate response with suggestions
    act(() => {
      sendCommand('fileSuggestionsResponse', {
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
    });

    // Wait for suggestions to render
    await waitFor(() => {
      const dropdown = document.querySelector('.file-suggestion-dropdown');
      expect(dropdown).toBeInTheDocument();
    });

    // Check for suggestion items
    const suggestionItems = document.querySelectorAll('.suggestion-item');
    // Expect to see the suggestions we injected (1 folder + 2 files) + 1 upload option = 4
    expect(suggestionItems.length).toBe(4);

    // Verify the first item is the upload option when no filter text
    const firstSuggestion = suggestionItems[0];
    expect(firstSuggestion).toHaveTextContent(/上传本地文件/);
    expect(firstSuggestion.className).toMatch(/upload-option/);
  });

  it('should filter files as user types after @', async () => {
    const { vscode } = renderChatApp();

    // Type @src to filter
    act(() => {
      typeInInput('@src');
    });

    // Wait for the debounced requestFileSuggestions request
    const reqId = await waitForFileSuggestionRequest(vscode);

    // Mock filtered response with captured requestId
    act(() => {
      sendCommand('fileSuggestionsResponse', {
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
    });

    // Wait for suggestion to render
    await waitFor(() => {
      const items = document.querySelectorAll('.suggestion-item');
      expect(items.length).toBe(1);
    });

    const suggestionItems = document.querySelectorAll('.suggestion-item');
    expect(suggestionItems.length).toBe(1);

    // Should only show filtered results (no upload option when there's filter text)
    const uploadOption = document.querySelector('.suggestion-item.upload-option');
    expect(uploadOption).toBeNull();

    // Verify the suggestion text contains the filter
    expect(suggestionItems[0]).toHaveTextContent(/src/);
  });
});
