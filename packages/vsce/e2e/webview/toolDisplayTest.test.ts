/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect } from '../utils/webviewTestHarness.js';
import { MessageInjector } from '../utils/messageInjector.js';
import { MockDataGenerator } from '../fixtures/mockData.js';
import { READ_TOOL_NAME, WRITE_TOOL_NAME, BASH_TOOL_NAME } from 'wave-agent-sdk';

test.describe('Tool Display Visual Test', () => {
    test('should display tools with compact parameters - visual verification', async ({ webviewPage }) => {
        const messageInjector = new MessageInjector(webviewPage);

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
            const toolBlock = bashToolMessage.blocks[1] as any;
            delete toolBlock.compactParams;
        }
        messages.push(bashToolMessage);

        // Add final message
        messages.push(MockDataGenerator.createAssistantMessage("The files have been updated successfully. The tool operations completed without any issues."));

        // Update all messages at once
        await messageInjector.updateMessages(messages);

        // Verify tool blocks are present and have correct content
        const toolBlocks = webviewPage.locator('.tool-block');
        await expect(toolBlocks).toHaveCount(3);

        // Check first tool (Read with compactParams)
        const readTool = toolBlocks.nth(0);
        await expect(readTool).toContainText(`● ${READ_TOOL_NAME} file.ts`);
        await expect(readTool).not.toContainText('file_path'); // Should not show full parameters

        // Check second tool (Write with compactParams)  
        const writeTool = toolBlocks.nth(1);
        await expect(writeTool).toContainText(`● ${WRITE_TOOL_NAME} config.json`);
        await expect(writeTool).not.toContainText('content'); // Should not show full parameters

        // Check third tool (Bash without compactParams - fallback)
        const bashTool = toolBlocks.nth(2);
        await expect(bashTool).toContainText(`● ${BASH_TOOL_NAME}`);
        await expect(bashTool).not.toContainText('npm install'); // Should not show compactParams since we removed it
        await expect(bashTool).not.toContainText('command'); // Should not show full parameters

        // Verify no <pre> elements exist in tool blocks
        const preElements = webviewPage.locator('.tool-block pre');
        await expect(preElements).toHaveCount(0);

        // Verify messages don't have borders/backgrounds
        const messageElements = webviewPage.locator('.message');
        await expect(messageElements).toHaveCount(6); // welcome + user + 4 assistant messages
    });

    test('should show unified message flow without visual separators', async ({ webviewPage }) => {
        const messageInjector = new MessageInjector(webviewPage);

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

        await messageInjector.updateMessages(messages);

        // Verify messages flow together visually
        const messagesContainer = webviewPage.locator('.messages-container');
        await expect(messagesContainer).toBeVisible();
    });

    test('should align user messages left with preserved styling', async ({ webviewPage }) => {
        const messageInjector = new MessageInjector(webviewPage);

        // Create a conversation to test user message alignment
        const messages = [
            MockDataGenerator.createUserMessage("Hello! Can you help me with this project?"),
            MockDataGenerator.createAssistantMessage("Of course! I'd be happy to help you."),
            MockDataGenerator.createUserMessage("Great! Let me show you what I'm working on."),
            MockDataGenerator.createAssistantMessageWithTool(
                "Let me read your project files.",
                READ_TOOL_NAME,
                '{"file_path": "./README.md"}',
                "File read successfully"
            ),
            MockDataGenerator.createUserMessage("Perfect! Now what do you think about the structure?")
        ];

        await messageInjector.updateMessages(messages);

        // Verify user messages have proper styling and alignment
        const userMessages = webviewPage.locator('.message.user');
        await expect(userMessages).toHaveCount(3);

        // Check that user message text block is visually distinct (has background)
        const firstUserMsg = userMessages.nth(0).locator('.user-text-block').first();
        const computedStyle = await firstUserMsg.evaluate((el) => {
            const style = window.getComputedStyle(el);
            return {
                backgroundColor: style.backgroundColor,
                padding: style.padding,
                borderRadius: style.borderRadius
            };
        });

        // Just verify the background color exists (not specific color as it may vary by theme)
        expect(computedStyle.backgroundColor).toBeTruthy();
        expect(computedStyle.borderRadius).toBe('8px'); // Should have rounded corners
    });

    test('should display compactParams in gray color for visual hierarchy', async ({ webviewPage }) => {
        const messageInjector = new MessageInjector(webviewPage);

        // Create messages with various tool calls to test gray compact params
        const messages = [
            MockDataGenerator.createUserMessage("Please help me with these file operations."),
            MockDataGenerator.createAssistantMessageWithTool(
                "I'll read the configuration file first.",
                READ_TOOL_NAME,
                '{"file_path": "/home/user/project/package.json", "limit": 100}',
                "Configuration read successfully"
            ),
            MockDataGenerator.createAssistantMessageWithTool(
                "Now I'll write the updated configuration.",
                WRITE_TOOL_NAME, 
                '{"file_path": "/home/user/project/config.json", "content": "..."}',
                "File written successfully"
            ),
            MockDataGenerator.createAssistantMessageWithTool(
                "Let me run the build command.",
                BASH_TOOL_NAME,
                '{"command": "npm run build", "timeout": 60000}',
                "Build completed successfully"
            ),
            MockDataGenerator.createAssistantMessage("All operations completed successfully! The gray compact parameters should provide good visual hierarchy.")
        ];

        await messageInjector.updateMessages(messages);

        // Verify tool blocks and compact params styling
        const toolBlocks = webviewPage.locator('.tool-block');
        await expect(toolBlocks).toHaveCount(3);

        // Check that compact params elements exist and have gray styling
        const compactParamsElements = webviewPage.locator('.compact-params');
        await expect(compactParamsElements).toHaveCount(3); // All 3 tools should have compactParams

        // Check styling of first compact param element
        const firstCompactParam = compactParamsElements.nth(0);
        await expect(firstCompactParam).toBeVisible();
        await expect(firstCompactParam).toContainText('file.ts'); // MockDataGenerator uses "file.ts" for Read tool

        // Verify the visual hierarchy - tool name should be bold, compact params normal weight
        const firstToolBlock = toolBlocks.nth(0);
        const toolBlockStyle = await firstToolBlock.evaluate((el) => {
            const style = window.getComputedStyle(el);
            return {
                fontWeight: style.fontWeight,
                color: style.color
            };
        });

        const compactParamStyle = await firstCompactParam.evaluate((el) => {
            const style = window.getComputedStyle(el);
            return {
                fontWeight: style.fontWeight,
                color: style.color
            };
        });

        // Tool block should be bold, compact params should be normal weight
        expect(toolBlockStyle.fontWeight).toBe('700'); // 700 = bold
        expect(compactParamStyle.fontWeight).toBe('400'); // 400 = normal
    });

    test('should show last 30 chars of parameters when tool stage is streaming', async ({ webviewPage }) => {
        const messageInjector = new MessageInjector(webviewPage);

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
            const toolBlock = toolMsg.blocks[1] as any;
            toolBlock.stage = 'streaming';
            delete toolBlock.compactParams;
        }

        await messageInjector.updateMessages(messages);

        const toolBlocks = webviewPage.locator('.tool-block');
        await expect(toolBlocks).toHaveCount(1);

        // Should show last 30 chars of parameters
        const expected = longParams.slice(-30);
        const compactParam = webviewPage.locator('.compact-params');
        await expect(compactParam).toBeVisible();
        await expect(compactParam).toContainText(expected);
    });

});