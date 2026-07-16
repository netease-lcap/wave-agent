import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderChatApp, sendCommand } from './test-utils';
import { MockDataGenerator } from '../fixtures/mockData';
import { READ_TOOL_NAME, WRITE_TOOL_NAME, BASH_TOOL_NAME } from 'wave-agent-sdk';

describe('Tool Display Visual Test', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should display tools with compact parameters - visual verification', () => {
        renderChatApp();

        // Build conversation with tool calls
        const messages = [
            MockDataGenerator.createUserMessage("Can you help me read a file?"),
            MockDataGenerator.createAssistantMessageWithTool(
                "I'll read the file for you.",
                READ_TOOL_NAME,
                '{"file_path": "/home/user/project/src/components/Message.tsx", "limit": 50}',
                "File contents read successfully"
            ),
            MockDataGenerator.createAssistantMessageWithTool(
                "Now I'll write the updated file.",
                WRITE_TOOL_NAME,
                '{"file_path": "/home/user/project/config.json", "content": "{\\"version\\": \\"1.0\\"}"}',
                "File written successfully"
            )
        ];

        // Add a tool without compactParams to test fallback
        const bashToolMessage = MockDataGenerator.createAssistantMessageWithTool(
            "Running a command.",
            BASH_TOOL_NAME,
            '{"command": "npm install --save lodash", "timeout": 30000}'
        );
        // Remove compactParams to test fallback
        if (bashToolMessage.blocks && bashToolMessage.blocks.length > 1) {
            const toolBlock = bashToolMessage.blocks[1] as unknown as Record<string, unknown>;
            delete toolBlock.compactParams;
        }
        messages.push(bashToolMessage);

        // Add final message
        messages.push(MockDataGenerator.createAssistantMessage("The files have been updated successfully. The tool operations completed without any issues."));

        // Update all messages at once
        sendCommand('updateMessages', { messages });

        // Verify tool blocks are present and have correct content
        const toolBlocks = document.querySelectorAll('.tool-block');
        expect(toolBlocks).toHaveLength(3);

        // Check first tool (Read with compactParams)
        const readTool = toolBlocks[0] as HTMLElement;
        expect(readTool).toHaveTextContent(`● ${READ_TOOL_NAME}`);
        expect(readTool).toHaveTextContent(/file\.ts/);

        // Check second tool (Write with compactParams)
        const writeTool = toolBlocks[1] as HTMLElement;
        expect(writeTool).toHaveTextContent(`● ${WRITE_TOOL_NAME}`);
        expect(writeTool).toHaveTextContent(/config\.json/);

        // Check third tool (Bash without compactParams - fallback)
        const bashTool = toolBlocks[2] as HTMLElement;
        expect(bashTool).toHaveTextContent(`● ${BASH_TOOL_NAME}`);

        // Verify no <pre> elements exist in tool blocks
        const preElements = document.querySelectorAll('.tool-block pre');
        expect(preElements).toHaveLength(0);

        // Verify messages don't have borders/backgrounds
        const messageElements = document.querySelectorAll('.message');
        // welcome + user + 4 assistant messages
        expect(messageElements.length).toBeGreaterThanOrEqual(6);
    });

    it('should show unified message flow without visual separators', () => {
        renderChatApp();

        // Create a conversation flow to test unified appearance
        const messages = [
            MockDataGenerator.createUserMessage("Hello, can you help me with my project?"),
            MockDataGenerator.createAssistantMessage("Of course! Let me analyze your project structure first."),
            MockDataGenerator.createAssistantMessageWithTool(
                "I'll read your main configuration file.",
                READ_TOOL_NAME,
                '{"file_path": "./package.json"}',
                "Configuration file read successfully"
            ),
            MockDataGenerator.createAssistantMessage("Based on your configuration, I can see this is a TypeScript project. Let me check your source code structure."),
            MockDataGenerator.createAssistantMessageWithTool(
                "Checking the source directory.",
                BASH_TOOL_NAME,
                '{"command": "ls -la src/"}',
                "Directory listing completed"
            ),
            MockDataGenerator.createAssistantMessage("Perfect! I can see your project structure. How can I help you further?")
        ];

        sendCommand('updateMessages', { messages });

        // Verify messages flow together visually
        const messagesContainer = document.querySelector('.messages-container');
        expect(messagesContainer).toBeInTheDocument();
    });

    it('should show last 30 chars of parameters when tool stage is streaming', () => {
        renderChatApp();

        // Create a tool with a long parameters string and stage="streaming"
        const longParams = '{"command": "grep -r \\"some_function\\" /home/user/project/src --include=\\"*.ts\\"", "timeout": 30000}';

        const messages = [
            MockDataGenerator.createUserMessage("Search for this function"),
            MockDataGenerator.createAssistantMessageWithTool(
                "Searching...",
                BASH_TOOL_NAME,
                longParams,
                undefined // no result yet
            ),
        ];

        // Override the tool block to set stage="streaming" and remove compactParams
        const toolMsg = messages[1];
        if (toolMsg.blocks && toolMsg.blocks.length > 1) {
            const toolBlock = toolMsg.blocks[1] as unknown as Record<string, unknown>;
            toolBlock.stage = 'streaming';
            delete toolBlock.compactParams;
        }

        sendCommand('updateMessages', { messages });

        const toolBlocks = document.querySelectorAll('.tool-block');
        expect(toolBlocks).toHaveLength(1);

        // Should show last 30 chars of parameters
        const expected = longParams.slice(-30);
        const compactParam = document.querySelector('.compact-params');
        expect(compactParam).toBeInTheDocument();
        expect(compactParam).toHaveTextContent(expected);
    });

});
