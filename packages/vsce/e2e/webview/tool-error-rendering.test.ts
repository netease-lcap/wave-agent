import { test, expect } from '../utils/webviewTestHarness.js';
import { MessageInjector } from '../utils/messageInjector.js';
import { MockDataGenerator } from '../fixtures/mockData.js';
import { READ_TOOL_NAME, BASH_TOOL_NAME, WRITE_TOOL_NAME } from 'wave-agent-sdk';

/**
 * Test tool block error rendering functionality
 * 
 * This test verifies that when a tool block has an error field,
 * it is rendered with the same styling as error blocks.
 */

test.describe('Tool Block Error Rendering', () => {
  test('should render tool error with proper styling', async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);

    // Create a message with a tool that has an error
    const messageWithToolError = MockDataGenerator.createAssistantMessageWithToolError(
      "I'll try to read the file for you.",
      READ_TOOL_NAME,
      '{"file_path": "/nonexistent/file.txt"}',
      "File not found: /nonexistent/file.txt"
    );

    // Inject the message
    await injector.updateMessages([messageWithToolError]);

    // Wait for the message to appear
    await webviewPage.waitForSelector('.message.assistant', { timeout: 5000 });

    // Verify tool block exists
    const toolBlock = await webviewPage.locator('.tool-block').first();
    await expect(toolBlock).toBeVisible();
    await expect(toolBlock).toContainText(`● ${READ_TOOL_NAME}`);

    // Verify tool error exists and has proper styling
    const toolError = await webviewPage.locator('.tool-error').first();
    await expect(toolError).toBeVisible();
    await expect(toolError).toContainText('File not found: /nonexistent/file.txt');

    // Verify error styling matches error block styling
    const errorStyles = await toolError.evaluate((element) => {
      const styles = window.getComputedStyle(element);
      return {
        color: styles.color,
        fontStyle: styles.fontStyle
      };
    });

    // The error should have italic styling
    expect(errorStyles.fontStyle).toBe('italic');
  });

  test('should render tool error for Bash tool with command output', async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);

    // Create a message with a Bash tool that has an error
    const bashToolError = MockDataGenerator.createAssistantMessageWithToolError(
      "I'll run that command for you.",
      BASH_TOOL_NAME, 
      '{"command": "invalid-command"}',
      "bash: invalid-command: command not found"
    );

    // Inject the message
    await injector.updateMessages([bashToolError]);

    // Wait for the message to appear
    await webviewPage.waitForSelector('.message.assistant', { timeout: 5000 });

    // Verify both tool block and error exist
    await expect(webviewPage.locator('.tool-block')).toContainText(`● ${BASH_TOOL_NAME}`);
    await expect(webviewPage.locator('.tool-error')).toContainText('bash: invalid-command: command not found');
  });

  test('should render tool error for file editing tools', async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);

    // Create a message with a Write tool that has an error
    const writeToolError = MockDataGenerator.createAssistantMessageWithToolError(
      "I'll create that file for you.",
      WRITE_TOOL_NAME,
      '{"file_path": "/readonly/file.txt", "content": "test"}',
      "Permission denied: /readonly/file.txt is not writable"
    );

    // Inject the message
    await injector.updateMessages([writeToolError]);

    // Wait for the message to appear
    await webviewPage.waitForSelector('.message.assistant', { timeout: 5000 });

    // Verify tool block and error exist
    await expect(webviewPage.locator('.tool-block')).toContainText(`● ${WRITE_TOOL_NAME}`);
    await expect(webviewPage.locator('.tool-error')).toContainText('Permission denied');
    
    // Verify diff viewer is NOT present when there's an error
    const diffViewer = webviewPage.locator('.diff-viewer-container');
    await expect(diffViewer).not.toBeVisible();
  });

  test('should render tool without error normally', async ({ webviewPage }) => {
    const injector = new MessageInjector(webviewPage);

    // Create a normal tool message without error
    const normalTool = MockDataGenerator.createAssistantMessageWithTool(
      "I'll read the file for you.",
      READ_TOOL_NAME,
      '{"file_path": "/project/package.json"}',
      '{"name": "test-project", "version": "1.0.0"}'
    );

    // Inject the message
    await injector.updateMessages([normalTool]);

    // Wait for the message to appear
    await webviewPage.waitForSelector('.message.assistant', { timeout: 5000 });

    // Verify tool block exists but no error
    await expect(webviewPage.locator('.tool-block')).toBeVisible();
    await expect(webviewPage.locator('.tool-error')).not.toBeVisible();
  });
});