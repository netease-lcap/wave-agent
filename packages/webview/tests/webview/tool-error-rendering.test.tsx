import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderChatApp, sendCommand } from './test-utils';
import { MockDataGenerator } from '../fixtures/mockData';
import { READ_TOOL_NAME, BASH_TOOL_NAME, WRITE_TOOL_NAME } from 'wave-agent-sdk';

/**
 * Test tool block error rendering functionality
 *
 * This test verifies that when a tool block has an error field,
 * it is rendered with the same styling as error blocks.
 */

describe('Tool Block Error Rendering', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render tool error with proper styling', () => {
        renderChatApp();

        // Create a message with a tool that has an error
        const messageWithToolError = MockDataGenerator.createAssistantMessageWithToolError(
            "I'll try to read the file for you.",
            READ_TOOL_NAME,
            '{"file_path": "/nonexistent/file.txt"}',
            "File not found: /nonexistent/file.txt"
        );

        // Inject the message
        sendCommand('updateMessages', { messages: [messageWithToolError] });

        // Verify tool block exists
        const toolBlock = document.querySelector('.tool-block');
        expect(toolBlock).toBeInTheDocument();
        expect(toolBlock).toHaveTextContent(`● ${READ_TOOL_NAME}`);

        // Verify tool error exists
        const toolError = document.querySelector('.tool-error');
        expect(toolError).toBeInTheDocument();
        expect(toolError).toHaveTextContent('File not found: /nonexistent/file.txt');
    });

    it('should render tool error for Bash tool with command output', () => {
        renderChatApp();

        // Create a message with a Bash tool that has an error
        const bashToolError = MockDataGenerator.createAssistantMessageWithToolError(
            "I'll run that command for you.",
            BASH_TOOL_NAME,
            '{"command": "invalid-command"}',
            "bash: invalid-command: command not found"
        );

        // Inject the message
        sendCommand('updateMessages', { messages: [bashToolError] });

        // Verify both tool block and error exist
        const toolBlock = document.querySelector('.tool-block');
        expect(toolBlock).toHaveTextContent(`● ${BASH_TOOL_NAME}`);
        const toolError = document.querySelector('.tool-error');
        expect(toolError).toHaveTextContent('bash: invalid-command: command not found');
    });

    it('should render tool error for file editing tools', () => {
        renderChatApp();

        // Create a message with a Write tool that has an error
        const writeToolError = MockDataGenerator.createAssistantMessageWithToolError(
            "I'll create that file for you.",
            WRITE_TOOL_NAME,
            '{"file_path": "/readonly/file.txt", "content": "test"}',
            "Permission denied: /readonly/file.txt is not writable"
        );

        // Inject the message
        sendCommand('updateMessages', { messages: [writeToolError] });

        // Verify tool block and error exist
        const toolBlock = document.querySelector('.tool-block');
        expect(toolBlock).toHaveTextContent(`● ${WRITE_TOOL_NAME}`);
        const toolError = document.querySelector('.tool-error');
        expect(toolError).toHaveTextContent('Permission denied');

        // Verify diff viewer is NOT present when there's an error
        const diffViewer = document.querySelector('.diff-viewer-container');
        expect(diffViewer).not.toBeInTheDocument();
    });

    it('should render tool without error normally', () => {
        renderChatApp();

        // Create a normal tool message without error
        const normalTool = MockDataGenerator.createAssistantMessageWithTool(
            "I'll read the file for you.",
            READ_TOOL_NAME,
            '{"file_path": "/project/package.json"}',
            '{"name": "test-project", "version": "1.0.0"}'
        );

        // Inject the message
        sendCommand('updateMessages', { messages: [normalTool] });

        // Verify tool block exists but no error
        const toolBlock = document.querySelector('.tool-block');
        expect(toolBlock).toBeInTheDocument();
        expect(document.querySelector('.tool-error')).not.toBeInTheDocument();
    });
});
