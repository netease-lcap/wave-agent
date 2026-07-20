import { renderChatApp, screen, waitFor, act, sendCommand, fireInput } from './test-utils';
import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Helper: type text into the contenteditable message input and set up
 * a selection inside a text node at the end.
 */
async function typeInInput(text: string) {
  const input = screen.getByTestId('message-input');
  input.focus();
  const existing = input.textContent || '';
  const fullText = existing + text;
  input.textContent = fullText;

  // Set selection at end of text node
  const range = document.createRange();
  if (input.firstChild && input.firstChild.nodeType === Node.TEXT_NODE) {
    const textNode = input.firstChild;
    range.setStart(textNode, textNode.textContent!.length);
    range.collapse(true);
  } else {
    range.selectNodeContents(input);
    range.collapse(false);
  }
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);

  await fireInput(input, { inputType: 'insertText' });
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

describe('File Upload Feature', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should not show any upload option when typing @ without filter text', async () => {
    const { vscode } = renderChatApp();

    await typeInInput('@');

    const reqId1 = await waitForFileSuggestionRequest(vscode);

    // Simulate response with no filter text and a single suggestion
    act(() => {
      sendCommand('fileSuggestionsResponse', {
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
    });

    // Wait for suggestions to render
    await waitFor(() => {
      const items = document.querySelectorAll('.suggestion-item');
      expect(items.length).toBe(1);
    });

    const suggestionItems = document.querySelectorAll('.suggestion-item');
    // Only the returned suggestion should render, no extra upload option.
    expect(suggestionItems.length).toBe(1);

    // Verify there is no upload option anymore
    const uploadOption = document.querySelector('.suggestion-item.upload-option');
    expect(uploadOption).toBeNull();

    // Verify the rendered suggestion is the returned file
    expect(suggestionItems[0]).toHaveTextContent(/test.tsx/);
  });

  it('should not show upload option when typing @ with filter text', async () => {
    const { vscode } = renderChatApp();

    await typeInInput('@test');

    const reqId = await waitForFileSuggestionRequest(vscode);

    // Mock filtered response with filter text
    act(() => {
      sendCommand('fileSuggestionsResponse', {
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
        filterText: 'test',
        requestId: reqId
      });
    });

    // Should only show filtered results (no upload option)
    await waitFor(() => {
      const items = document.querySelectorAll('.suggestion-item');
      expect(items.length).toBe(1);
    });

    const suggestionItems = document.querySelectorAll('.suggestion-item');
    expect(suggestionItems.length).toBe(1);

    // Verify there's no upload option
    const uploadOption = document.querySelector('.suggestion-item.upload-option');
    expect(uploadOption).toBeNull();

    // Verify the suggestion is the filtered file
    expect(suggestionItems[0]).toHaveTextContent(/test.tsx/);
  });

  it('should insert file paths into input after successful upload', async () => {
    renderChatApp();

    // No @ mention needed: upload flow no longer goes through @.
    const input = screen.getByTestId('message-input');
    input.focus();

    // Simulate successful file upload response
    act(() => {
      sendCommand('uploadSuccess', {
        uploadedFiles: [
          '/tmp/wave-artifacts/document.pdf',
          '/tmp/wave-artifacts/image.png'
        ],
        message: '成功上传 2 个文件到临时目录'
      });
    });

    // Verify that file paths are inserted into the input as tags
    await waitFor(() => {
      const tags = document.querySelectorAll('[data-testid="message-input"] .context-tag');
      expect(tags.length).toBe(2);
    });

    const inputValue = input.textContent?.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
    expect(inputValue).toContain('document.pdf');
    expect(inputValue).toContain('image.png');
  });

  it('should handle single file upload path insertion', async () => {
    renderChatApp();

    const input = screen.getByTestId('message-input');
    input.focus();

    // Simulate successful single file upload response
    act(() => {
      sendCommand('uploadSuccess', {
        uploadedFiles: [
          '/tmp/wave-artifacts/single-file.txt'
        ],
        message: '成功上传 1 个文件到临时目录'
      });
    });

    // Verify that single file path is inserted into the input as a tag
    await waitFor(() => {
      const tags = document.querySelectorAll('[data-testid="message-input"] .context-tag');
      expect(tags.length).toBe(1);
    });

    const inputValue = input.textContent?.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
    expect(inputValue).toContain('single-file.txt');
  });

  it('should insert file path after existing input text', async () => {
    renderChatApp();

    // Type some plain text first, then upload — the tag is appended at the cursor/end.
    await typeInInput('hello ');

    const input = screen.getByTestId('message-input');

    // Simulate successful file upload response
    act(() => {
      sendCommand('uploadSuccess', {
        uploadedFiles: [
          '/tmp/wave-artifacts/test.pdf'
        ],
        message: '成功上传 1 个文件到临时目录'
      });
    });

    // Verify that file path is inserted into the input as a tag
    await waitFor(() => {
      const tags = document.querySelectorAll('[data-testid="message-input"] .context-tag');
      expect(tags.length).toBe(1);
    });

    const inputValue = input.textContent?.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
    expect(inputValue).toContain('test.pdf');
    // Existing input text is preserved (no longer replaced by the upload flow).
    expect(inputValue).toContain('hello');
  });
});
