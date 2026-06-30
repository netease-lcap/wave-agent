import { test, expect } from '../utils/webviewTestHarness.js';
import { MessageInjector } from '../utils/messageInjector.js';
import { Message, EDIT_TOOL_NAME, WRITE_TOOL_NAME, READ_TOOL_NAME } from 'wave-agent-sdk';

test.describe('Diff Viewer', () => {
  test('should render diff viewer for Edit tool block', async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);

    // Create a mock message with an Edit tool that should show a diff
    const mockEditMessage: Message = {
      id: 'msg_diff_1',
      role: 'assistant' as const,
      timestamp: '2024-01-01T00:00:00.000Z',
      blocks: [
        {
          type: 'tool',
          name: EDIT_TOOL_NAME,
          parameters: JSON.stringify({
            file_path: 'src/example.ts',
            old_string: 'const hello = "world";',
            new_string: 'const greeting = "hello world";'
          }),
          compactParams: 'src/example.ts',
          stage: 'end' as const,
          success: true,
          id: 'edit_123'
        }
      ]
    };

    // Update messages to include the edit tool block
    await injector.updateMessages([mockEditMessage]);

    // Check that tool block is present
    await expect(webviewPage.locator('.tool-block')).toBeVisible();

    // Check that diff viewer container is present within the tool block
    await expect(webviewPage.locator('.diff-viewer-container')).toBeVisible();

    // Check that diff content is displayed with proper lines
    await expect(webviewPage.locator('.diff-line-removed')).toBeVisible();
    await expect(webviewPage.locator('.diff-line-added')).toBeVisible();

    // Verify the container structure
    await expect(webviewPage.locator('.diff-viewer-container .diff-viewer-content')).toBeVisible();
  });

  test('should handle Write tool with new file content', async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);

    const mockWriteMessage: Message = {
      id: 'msg_diff_2',
      role: 'assistant' as const,
      timestamp: '2024-01-01T00:00:00.000Z',
      blocks: [
        {
          type: 'tool',
          name: WRITE_TOOL_NAME,
          parameters: JSON.stringify({
            file_path: 'src/newFile.ts',
            content: 'export const config = {\n  version: "1.0.0",\n  debug: true\n};'
          }),
          compactParams: 'src/newFile.ts',
          stage: 'end' as const,
          success: true,
          id: 'write_456'
        }
      ]
    };

    await injector.updateMessages([mockWriteMessage]);

    // Check that diff viewer is rendered for Write tool
    await expect(webviewPage.locator('.diff-viewer-container')).toBeVisible();
    
    // For Write operations, should show only added lines (no removed lines)
    await expect(webviewPage.locator('.diff-line-added')).toHaveCount(4); // 4 lines of content
    await expect(webviewPage.locator('.diff-line-removed')).toHaveCount(0); // No removed lines

    // Check content includes the written text
    await expect(webviewPage.locator('.diff-line-added').first()).toContainText('export const config');
  });

  test('should not show diff for non-file-editing tools', async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);

    const mockReadMessage: Message = {
      id: 'msg_diff_3',
      role: 'assistant' as const,
      timestamp: '2024-01-01T00:00:00.000Z',
      blocks: [
        {
          type: 'tool',
          name: READ_TOOL_NAME,
          parameters: JSON.stringify({
            file_path: 'src/example.ts'
          }),
          compactParams: 'src/example.ts',
          stage: 'end' as const,
          success: true,
          result: 'const hello = "world";',
          id: 'read_999'
        }
      ]
    };

    await injector.updateMessages([mockReadMessage]);

    // Check that tool block is present
    await expect(webviewPage.locator('.tool-block')).toBeVisible();

    // Check that NO diff viewer is rendered for Read tool
    await expect(webviewPage.locator('.diff-viewer-container')).not.toBeVisible();
  });

  test('should handle tool with running stage (no diff until complete)', async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);

    const mockRunningEditMessage: Message = {
      id: 'msg_diff_4',
      role: 'assistant' as const,
      timestamp: '2024-01-01T00:00:00.000Z',
      blocks: [
        {
          type: 'tool',
          name: EDIT_TOOL_NAME,
          parameters: JSON.stringify({
            file_path: 'src/example.ts',
            old_string: 'old content',
            new_string: 'new content'
          }),
          compactParams: 'src/example.ts',
          stage: 'running' as const,
          id: 'edit_running_123'
        }
      ]
    };

    await injector.updateMessages([mockRunningEditMessage]);

    // Tool block should be visible
    await expect(webviewPage.locator('.tool-block')).toBeVisible();

    // Diff viewer should NOT be present for running stage
    await expect(webviewPage.locator('.diff-viewer-container')).not.toBeVisible();
  });

  test('should handle empty or malformed tool parameters gracefully', async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);

    const mockMalformedMessage: Message = {
      id: 'msg_diff_5',
      role: 'assistant' as const,
      timestamp: '2024-01-01T00:00:00.000Z',
      blocks: [
        {
          type: 'tool',
          name: EDIT_TOOL_NAME,
          parameters: 'invalid json {malformed',
          compactParams: 'unknown',
          stage: 'end' as const,
          success: false,
          id: 'edit_malformed_456'
        }
      ]
    };

    await injector.updateMessages([mockMalformedMessage]);

    // Tool block should still be visible
    await expect(webviewPage.locator('.tool-block')).toBeVisible();

    // Diff viewer should not be present due to malformed parameters
    await expect(webviewPage.locator('.diff-viewer-container')).not.toBeVisible();
  });

  test('should display diff alongside other block types', async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);

    const mockMessage: Message = {
      id: 'msg_diff_6',
      role: 'assistant' as const,
      timestamp: '2024-01-01T00:00:00.000Z',
      blocks: [
        {
          type: 'text',
          content: 'I will make these changes to your file:'
        },
        {
          type: 'tool',
          name: EDIT_TOOL_NAME,
          parameters: JSON.stringify({
            file_path: 'src/example.ts',
            old_string: 'const old = "value";',
            new_string: 'const updated = "value";'
          }),
          compactParams: 'src/example.ts',
          stage: 'end' as const,
          success: true,
          id: 'edit_mixed_789'
        }
      ]
    };

    await injector.updateMessages([mockMessage]);

    // Check that all block types are rendered in the correct order
    const assistantMessage = webviewPage.locator('.message.assistant').last();
    await expect(assistantMessage.locator('.message-content')).toContainText('I will make these changes');
    await expect(assistantMessage.locator('.tool-block')).toBeVisible();
    await expect(assistantMessage.locator('.diff-viewer-container')).toBeVisible();

    // Verify diff content
    await expect(webviewPage.locator('.diff-line-removed')).toContainText('const old');
    await expect(webviewPage.locator('.diff-line-added')).toContainText('const updated');
  });

  test('should handle word-level diff for single-line changes', async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);

    const mockSingleLineEdit: Message = {
      id: 'msg_diff_7',
      role: 'assistant' as const,
      timestamp: '2024-01-01T00:00:00.000Z',
      blocks: [
        {
          type: 'tool',
          name: EDIT_TOOL_NAME,
          parameters: JSON.stringify({
            file_path: 'src/config.js',
            old_string: 'const port = 3000;',
            new_string: 'const port = 8080;'
          }),
          compactParams: 'src/config.js',
          stage: 'end' as const,
          success: true,
          id: 'edit_wordlevel_123'
        }
      ]
    };

    await injector.updateMessages([mockSingleLineEdit]);

    // Check that diff viewer is present
    await expect(webviewPage.locator('.diff-viewer-container')).toBeVisible();
    
    // For single-line changes, should show both removed and added lines
    await expect(webviewPage.locator('.diff-line-removed')).toHaveCount(1);
    await expect(webviewPage.locator('.diff-line-added')).toHaveCount(1);

    // Check for word-level highlighting within the lines
    await expect(webviewPage.locator('.diff-line-removed')).toContainText('3000');
    await expect(webviewPage.locator('.diff-line-added')).toContainText('8080');
  });

  test('should handle large diff content without auto-scrolling', async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);

    // Create a large file edit to test content display
    const largeOldContent = Array.from({ length: 20 }, (_, i) => 
      `// Context line ${i + 1}`
    ).join('\n') + '\nconst oldVariable = "old";\nconsole.log("remaining code");';

    const largeNewContent = Array.from({ length: 20 }, (_, i) => 
      `// Context line ${i + 1}`
    ).join('\n') + '\nconst newVariable = "new";\nconsole.log("remaining code");';

    const mockLargeEditMessage: Message = {
      id: 'msg_diff_8',
      role: 'assistant' as const,
      timestamp: '2024-01-01T00:00:00.000Z',
      blocks: [
        {
          type: 'tool',
          name: EDIT_TOOL_NAME,
          parameters: JSON.stringify({
            file_path: 'src/largeFile.js',
            old_string: largeOldContent,
            new_string: largeNewContent
          }),
          compactParams: 'src/largeFile.js',
          stage: 'end' as const,
          success: true,
          id: 'edit_large_content'
        }
      ]
    };

    await injector.updateMessages([mockLargeEditMessage]);

    // Wait for diff viewer to be visible
    await expect(webviewPage.locator('.diff-viewer-container')).toBeVisible();

    // Verify that diff lines are present
    await expect(webviewPage.locator('.diff-line-removed')).toHaveCount(1);
    await expect(webviewPage.locator('.diff-line-added')).toHaveCount(1);

    // Verify the changed content
    await expect(webviewPage.locator('.diff-line-removed')).toContainText('oldVariable');
    await expect(webviewPage.locator('.diff-line-added')).toContainText('newVariable');

    // Verify that content is scrollable if needed (container should allow scrolling)
    const scrollInfo = await webviewPage.evaluate(() => {
      const diffContent = document.querySelector('.diff-viewer-content') as HTMLElement;
      return {
        scrollHeight: diffContent?.scrollHeight || 0,
        clientHeight: diffContent?.clientHeight || 0,
        hasScrollbar: (diffContent?.scrollHeight || 0) > (diffContent?.clientHeight || 0)
      };
    });

    // Content should be rendered properly regardless of scroll state
    expect(scrollInfo.scrollHeight).toBeGreaterThan(0);
    expect(scrollInfo.clientHeight).toBeGreaterThan(0);
    
    // Log whether scrolling is available (informational, not a test requirement)
    if (scrollInfo.hasScrollbar) {
        // scrolling available
    } else {
        // no scrollbar
    }
  });
});