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

  it('should show upload option when typing @ without filter text', async () => {
    const { vscode } = renderChatApp();

    await typeInInput('@');

    const reqId1 = await waitForFileSuggestionRequest(vscode);

    // Simulate response with no filter text
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
      expect(items.length).toBe(2);
    });

    const suggestionItems = document.querySelectorAll('.suggestion-item');
    // Should have upload option + 1 file = 2 items
    expect(suggestionItems.length).toBe(2);

    // Verify the first item is the upload option
    const uploadOption = suggestionItems[0];
    expect(uploadOption).toHaveTextContent(/上传本地文件/);
    expect(uploadOption.className).toMatch(/upload-option/);

    // Verify upload option has correct icon
    const uploadIcon = uploadOption.querySelector('.codicon-cloud-upload');
    expect(uploadIcon).toBeInTheDocument();
  });

  it('should hide upload option when typing @ with filter text', async () => {
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

    // Should only show filtered results (no upload option when there's filter text)
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

  it('should handle upload option selection', async () => {
    const { vscode } = renderChatApp();

    await typeInInput('@');

    const reqId = await waitForFileSuggestionRequest(vscode);

    // Simulate response with no filter text to show upload option
    act(() => {
      sendCommand('fileSuggestionsResponse', {
        suggestions: [],
        filterText: '',
        requestId: reqId
      });
    });

    // Find the upload option
    await waitFor(() => {
      const uploadOption = document.querySelector('.suggestion-item.upload-option');
      expect(uploadOption).toBeInTheDocument();
    });

    const uploadOption = document.querySelector('.suggestion-item.upload-option')!;
    // Verify the upload option text
    expect(uploadOption).toHaveTextContent(/上传本地文件/);
    expect(uploadOption).toHaveTextContent(/选择本地文件上传到临时目录/);
  });

  it('should insert file paths into input after successful upload', async () => {
    const { vscode } = renderChatApp();

    await typeInInput('@');

    await waitForFileSuggestionRequest(vscode);

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

    const input = screen.getByTestId('message-input');
    const inputValue = input.textContent?.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
    expect(inputValue).toContain('document.pdf');
    expect(inputValue).toContain('image.png');
  });

  it('should handle single file upload path insertion', async () => {
    const { vscode } = renderChatApp();

    await typeInInput('@');

    await waitForFileSuggestionRequest(vscode);

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

    const input = screen.getByTestId('message-input');
    const inputValue = input.textContent?.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
    expect(inputValue).toContain('single-file.txt');
  });

  it('should insert file path correctly in basic scenario', async () => {
    const { vscode } = renderChatApp();

    await typeInInput('@');

    await waitForFileSuggestionRequest(vscode);

    // Simulate successful file upload response
    act(() => {
      sendCommand('uploadSuccess', {
        uploadedFiles: [
          '/tmp/wave-artifacts/test.pdf'
        ],
        message: '成功上传 1 个文件到临时目录'
      });
    });

    // Verify that file path replaces the @ symbol correctly as a tag
    await waitFor(() => {
      const tags = document.querySelectorAll('[data-testid="message-input"] .context-tag');
      expect(tags.length).toBe(1);
    });

    const input = screen.getByTestId('message-input');
    const inputValue = input.textContent?.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
    expect(inputValue).toContain('test.pdf');
  });

  it('should not add extra @ symbol when inserting file paths', async () => {
    const { vscode } = renderChatApp();

    await typeInInput('@test');

    await waitForFileSuggestionRequest(vscode);

    // Simulate successful file upload response
    act(() => {
      sendCommand('uploadSuccess', {
        uploadedFiles: [
          '/tmp/wave-artifacts/uploaded-file.txt'
        ],
        message: '成功上传 1 个文件到临时目录'
      });
    });

    // Verify that file path replaces filter text correctly and doesn't add extra @
    await waitFor(() => {
      const tags = document.querySelectorAll('[data-testid="message-input"] .context-tag');
      expect(tags.length).toBe(1);
    });

    const input = screen.getByTestId('message-input');
    const inputValue = input.textContent?.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
    expect(inputValue).toContain('uploaded-file.txt');
    // Should not contain leftover @test filter text
    expect(inputValue).not.toContain('@test');
  });
});
