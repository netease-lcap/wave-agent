import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderChatApp, sendCommand } from './test-utils';
import { Message, EDIT_TOOL_NAME, WRITE_TOOL_NAME, READ_TOOL_NAME } from 'wave-agent-sdk';

describe('Diff Viewer', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render diff viewer for Edit tool block', () => {
        renderChatApp();

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

        sendCommand('updateMessages', { messages: [mockEditMessage] });

        // Check that tool block is present
        const toolBlock = document.querySelector('.tool-block');
        expect(toolBlock).toBeInTheDocument();

        // Check that diff viewer container is present within the tool block
        const diffContainer = document.querySelector('.diff-viewer-container');
        expect(diffContainer).toBeInTheDocument();

        // Check that diff content is displayed with proper lines
        const removedLine = document.querySelector('.diff-line-removed');
        expect(removedLine).toBeInTheDocument();
        const addedLine = document.querySelector('.diff-line-added');
        expect(addedLine).toBeInTheDocument();

        // Verify the container structure
        const diffContent = document.querySelector('.diff-viewer-container .diff-viewer-content');
        expect(diffContent).toBeInTheDocument();
    });

    it('should handle Write tool with new file content', () => {
        renderChatApp();

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

        sendCommand('updateMessages', { messages: [mockWriteMessage] });

        // Check that diff viewer is rendered for Write tool
        const diffContainer = document.querySelector('.diff-viewer-container');
        expect(diffContainer).toBeInTheDocument();

        // For Write operations, should show only added lines (no removed lines)
        const addedLines = document.querySelectorAll('.diff-line-added');
        expect(addedLines.length).toBeGreaterThanOrEqual(3); // content lines

        const removedLines = document.querySelectorAll('.diff-line-removed');
        expect(removedLines).toHaveLength(0);

        // Check content includes the written text
        expect(addedLines[0]).toHaveTextContent(/export const config/);
    });

    it('should not show diff for non-file-editing tools', () => {
        renderChatApp();

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

        sendCommand('updateMessages', { messages: [mockReadMessage] });

        // Check that tool block is present
        const toolBlock = document.querySelector('.tool-block');
        expect(toolBlock).toBeInTheDocument();

        // Check that NO diff viewer is rendered for Read tool
        const diffContainer = document.querySelector('.diff-viewer-container');
        expect(diffContainer).not.toBeInTheDocument();
    });

    it('should handle tool with running stage (no diff until complete)', () => {
        renderChatApp();

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

        sendCommand('updateMessages', { messages: [mockRunningEditMessage] });

        // Tool block should be visible
        const toolBlock = document.querySelector('.tool-block');
        expect(toolBlock).toBeInTheDocument();

        // Diff viewer should NOT be present for running stage
        const diffContainer = document.querySelector('.diff-viewer-container');
        expect(diffContainer).not.toBeInTheDocument();
    });

    it('should handle empty or malformed tool parameters gracefully', () => {
        renderChatApp();

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

        sendCommand('updateMessages', { messages: [mockMalformedMessage] });

        // Tool block should still be visible
        const toolBlock = document.querySelector('.tool-block');
        expect(toolBlock).toBeInTheDocument();

        // Diff viewer should not be present due to malformed parameters
        const diffContainer = document.querySelector('.diff-viewer-container');
        expect(diffContainer).not.toBeInTheDocument();
    });

    it('should display diff alongside other block types', () => {
        renderChatApp();

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

        sendCommand('updateMessages', { messages: [mockMessage] });

        // Check that all block types are rendered in the correct order
        const assistantMessages = document.querySelectorAll('.message.assistant');
        const lastAssistant = assistantMessages[assistantMessages.length - 1];
        expect(lastAssistant).toBeInTheDocument();

        const messageContent = lastAssistant.querySelector('.message-content');
        expect(messageContent).toHaveTextContent(/I will make these changes/);

        const toolBlock = lastAssistant.querySelector('.tool-block');
        expect(toolBlock).toBeInTheDocument();

        const diffContainer = lastAssistant.querySelector('.diff-viewer-container');
        expect(diffContainer).toBeInTheDocument();

        // Verify diff content
        const removedLine = document.querySelector('.diff-line-removed');
        expect(removedLine).toHaveTextContent(/const old/);
        const addedLine = document.querySelector('.diff-line-added');
        expect(addedLine).toHaveTextContent(/const updated/);
    });

    it('should handle word-level diff for single-line changes', () => {
        renderChatApp();

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

        sendCommand('updateMessages', { messages: [mockSingleLineEdit] });

        // Check that diff viewer is present
        const diffContainer = document.querySelector('.diff-viewer-container');
        expect(diffContainer).toBeInTheDocument();

        // For single-line changes, should show both removed and added lines
        const removedLines = document.querySelectorAll('.diff-line-removed');
        expect(removedLines.length).toBeGreaterThanOrEqual(1);

        const addedLines = document.querySelectorAll('.diff-line-added');
        expect(addedLines.length).toBeGreaterThanOrEqual(1);

        // Check for word-level highlighting within the lines
        expect(removedLines[0]).toHaveTextContent(/3000/);
        expect(addedLines[0]).toHaveTextContent(/8080/);
    });

});
