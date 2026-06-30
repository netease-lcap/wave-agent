import { test, expect } from '../utils/webviewTestHarness.js';
import { MessageInjector } from '../utils/messageInjector.js';
import { EDIT_TOOL_NAME, BASH_TOOL_NAME, WRITE_TOOL_NAME, EXIT_PLAN_MODE_TOOL_NAME, Message } from 'wave-agent-sdk';

test.describe('Confirmation Dialog', () => {
    test('should show confirmation dialog for ExitPlanMode with planContent', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);

        const planContent = '## Test Plan\n- Step 1\n- Step 2';
        
        // Simulate a confirmation request for ExitPlanMode tool
        await injector.simulateExtensionMessage('showConfirmation', {
            confirmationId: 'test_plan_confirmation',
            toolName: EXIT_PLAN_MODE_TOOL_NAME,
            confirmationType: '计划待确认',
            planContent: planContent
        });

        // Verify confirmation dialog is visible
        const confirmationDialog = webviewPage.locator('.confirmation-dialog');
        await expect(confirmationDialog).toBeVisible();

        // Verify plan content is rendered
        const planPreview = webviewPage.locator('.plan-content-preview');
        await expect(planPreview).toBeVisible();
        await expect(planPreview.locator('h2')).toHaveText('Test Plan');
        await expect(planPreview.locator('li')).toHaveCount(2);

        // Verify buttons
        await expect(webviewPage.locator('.confirmation-btn-apply')).toHaveText('批准并继续');
        await expect(webviewPage.locator('.confirmation-btn-auto')).toHaveText('批准并自动接受后续修改');
    });

    test('should show confirmation dialog for code modification tools', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);

        // Simulate a confirmation request for Edit tool
        await injector.simulateExtensionMessage('showConfirmation', {
            confirmationId: 'test_confirmation_123',
            toolName: EDIT_TOOL_NAME,
            confirmationType: '代码修改待确认',
            toolInput: { file_path: 'test.ts', old_string: 'old', new_string: 'new' }
        });

        // Verify confirmation dialog is visible
        const confirmationDialog = webviewPage.locator('.confirmation-dialog');
        await expect(confirmationDialog).toBeVisible();

        // Verify dialog content
        await expect(webviewPage.locator('.confirmation-title')).toHaveText('代码修改待确认');
        await expect(webviewPage.locator('.confirmation-details')).toContainText(`工具: ${EDIT_TOOL_NAME}`);

        // Verify buttons are present
        await expect(webviewPage.locator('.confirmation-btn-apply')).toHaveText('批准并继续');
        await expect(webviewPage.locator('.confirmation-btn-feedback')).toHaveText('提供反馈');
        await expect(webviewPage.locator('.confirmation-btn-reject')).not.toBeVisible();

        // Verify input is hidden when confirmation is showing
        await expect(webviewPage.getByTestId('message-input')).not.toBeVisible();
    });

    test('should show confirmation dialog for command execution tools', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);

        // Simulate a confirmation request for Bash tool
        await injector.simulateExtensionMessage('showConfirmation', {
            confirmationId: 'test_confirmation_456',
            toolName: BASH_TOOL_NAME,
            confirmationType: '命令执行待确认',
            toolInput: { command: 'rm -rf temp/' }
        });

        // Verify confirmation dialog content for bash command
        await expect(webviewPage.locator('.confirmation-title')).toHaveText('命令执行待确认');
        await expect(webviewPage.locator('.confirmation-details')).toContainText(`工具: ${BASH_TOOL_NAME}`);
    });

    test('should send approval response when clicking apply button', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);

        // Clear message log before starting
        await injector.clearMessageLog();

        // Simulate confirmation request
        await injector.simulateExtensionMessage('showConfirmation', {
            confirmationId: 'test_confirmation_789',
            toolName: WRITE_TOOL_NAME,
            confirmationType: '代码修改待确认',
            toolInput: { file_path: 'new_file.ts', content: 'console.log("hello");' }
        });

        // Click apply button
        await webviewPage.locator('.confirmation-btn-apply').click();

        // Verify confirmation dialog is hidden
        await expect(webviewPage.locator('.confirmation-dialog')).not.toBeVisible();

        // Verify input is visible again
        await expect(webviewPage.getByTestId('message-input')).toBeVisible();

        // Verify approval message was sent to extension
        const sentMessages = await injector.getMessagesSentToExtension();
        expect(sentMessages).toHaveLength(1);
        expect(sentMessages[0]).toEqual({
            command: 'confirmationResponse',
            confirmationId: 'test_confirmation_789',
            approved: true,
            decision: {
                behavior: 'allow',
                newPermissionMode: undefined
            }
        });
    });

    test('should send rejection response when clicking close button', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);

        // Clear message log
        await injector.clearMessageLog();

        // Simulate confirmation request
        await injector.simulateExtensionMessage('showConfirmation', {
            confirmationId: 'test_confirmation_reject',
            toolName: 'SomeOtherTool',
            confirmationType: '操作待确认',
            toolInput: {}
        });

        // Click close button
        await webviewPage.locator('.confirmation-close-btn').click();

        // Verify confirmation dialog is hidden
        await expect(webviewPage.locator('.confirmation-dialog')).not.toBeVisible();

        // Verify input is visible again
        await expect(webviewPage.getByTestId('message-input')).toBeVisible();

        // Verify rejection message was sent to extension
        const sentMessages = await injector.getMessagesSentToExtension();
        expect(sentMessages).toHaveLength(1);
        expect(sentMessages[0]).toEqual({
            command: 'confirmationResponse',
            confirmationId: 'test_confirmation_reject',
            approved: false
        });
    });

    test('should handle multiple confirmation requests sequentially', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);

        // Clear message log
        await injector.clearMessageLog();

        // First confirmation request
        await injector.simulateExtensionMessage('showConfirmation', {
            confirmationId: 'confirmation_1',
            toolName: EDIT_TOOL_NAME,
            confirmationType: '代码修改待确认',
            toolInput: { file_path: 'file1.ts' }
        });

        // Verify first confirmation is visible
        await expect(webviewPage.locator('.confirmation-dialog')).toBeVisible();
        await expect(webviewPage.locator('.confirmation-details')).toContainText(`工具: ${EDIT_TOOL_NAME}`);

        // Approve first confirmation
        await webviewPage.locator('.confirmation-btn-apply').click();

        // Verify dialog is hidden
        await expect(webviewPage.locator('.confirmation-dialog')).not.toBeVisible();

        // Second confirmation request
        await injector.simulateExtensionMessage('showConfirmation', {
            confirmationId: 'confirmation_2',
            toolName: 'SomeOtherTool',
            confirmationType: '操作待确认',
            toolInput: {}
        });

        // Verify second confirmation is visible with correct content
        await expect(webviewPage.locator('.confirmation-dialog')).toBeVisible();
        await expect(webviewPage.locator('.confirmation-details')).toContainText('工具: SomeOtherTool');

        // Reject second confirmation via Esc key
        await webviewPage.keyboard.press('Escape');

        // Verify both responses were sent
        const sentMessages = await injector.getMessagesSentToExtension();
        expect(sentMessages).toHaveLength(2);
        expect(sentMessages[0]).toEqual({
            command: 'confirmationResponse',
            confirmationId: 'confirmation_1',
            approved: true,
            decision: {
                behavior: 'allow',
                newPermissionMode: undefined
            }
        });
        expect(sentMessages[1]).toEqual({
            command: 'confirmationResponse',
            confirmationId: 'confirmation_2',
            approved: false
        });
    });

    test('should handle multiple simultaneous confirmation requests in a queue', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);

        // Clear message log
        await injector.clearMessageLog();

        // Send first confirmation request
        await injector.simulateExtensionMessage('showConfirmation', {
            confirmationId: 'conf_1',
            toolName: EDIT_TOOL_NAME,
            confirmationType: '代码修改待确认',
            toolInput: { file_path: 'file1.ts' }
        });

        // Verify first confirmation is visible
        await expect(webviewPage.locator('.confirmation-dialog')).toBeVisible();
        await expect(webviewPage.locator('.confirmation-details')).toContainText(`工具: ${EDIT_TOOL_NAME}`);

        // Send second confirmation request while first is still showing
        await injector.simulateExtensionMessage('showConfirmation', {
            confirmationId: 'conf_2',
            toolName: BASH_TOOL_NAME,
            confirmationType: '命令执行待确认',
            toolInput: { command: 'ls' }
        });

        // Still should show first confirmation
        await expect(webviewPage.locator('.confirmation-details')).toContainText(`工具: ${EDIT_TOOL_NAME}`);

        // Approve first confirmation
        await webviewPage.locator('.confirmation-btn-apply').click();

        // Verify second confirmation is now visible
        await expect(webviewPage.locator('.confirmation-dialog')).toBeVisible();
        await expect(webviewPage.locator('.confirmation-details')).toContainText(`工具: ${BASH_TOOL_NAME}`);

        // Approve second confirmation
        await webviewPage.locator('.confirmation-btn-apply').click();

        // Verify dialog is hidden and input is visible
        await expect(webviewPage.locator('.confirmation-dialog')).not.toBeVisible();
        await expect(webviewPage.getByTestId('message-input')).toBeVisible();

        // Verify both responses were sent
        const sentMessages = await injector.getMessagesSentToExtension();
        expect(sentMessages).toHaveLength(2);
        expect(sentMessages[0]).toEqual({
            command: 'confirmationResponse',
            confirmationId: 'conf_1',
            approved: true,
            decision: {
                behavior: 'allow',
                newPermissionMode: undefined
            }
        });
        expect(sentMessages[1]).toEqual({
            command: 'confirmationResponse',
            confirmationId: 'conf_2',
            approved: true,
            decision: {
                behavior: 'allow',
                newPermissionMode: undefined
            }
        });
    });

    test('should position confirmation dialog at bottom and not overlap messages', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);

        // Add some messages first to create content above
        const testMessages: Message[] = [
            {
                id: 'msg_conf_pos_1',
                role: 'user' as const,
                timestamp: '2024-01-01T00:00:00.000Z',
                blocks: [{ type: 'text', content: 'Test message 1' }]
            },
            {
                id: 'msg_conf_pos_2',
                role: 'assistant' as const,
                timestamp: '2024-01-01T00:00:00.000Z',
                blocks: [{ type: 'text', content: 'Test response 1' }]
            }
        ];

        await injector.updateMessages(testMessages);

        // Simulate confirmation request
        await injector.simulateExtensionMessage('showConfirmation', {
            confirmationId: 'test_position',
            toolName: WRITE_TOOL_NAME,
            confirmationType: '代码修改待确认',
            toolInput: {}
        });

        // Verify dialog is visible
        const dialog = webviewPage.locator('.confirmation-dialog');
        await expect(dialog).toBeVisible();

        // Verify dialog uses normal document flow positioning (not fixed)
        const position = await dialog.evaluate(el => {
            const styles = window.getComputedStyle(el);
            return {
                position: styles.position
            };
        });

        expect(position.position).toBe('static');

        // Verify dialog is at the bottom by checking it appears after messages
        const chatContainer = webviewPage.locator('.chat-container');
        const elementsOrder = await chatContainer.evaluate(container => {
            const elements = Array.from(container.children);
            return elements.map(el => el.className.split(' ')[0]); // Get first class name
        });

        // input-area-container should be the last element in the chat container
        expect(elementsOrder[elementsOrder.length - 1]).toBe('input-area-container');

        // Verify confirmation dialog is inside input-area-container
        await expect(webviewPage.locator('.input-area-container .confirmation-dialog')).toBeVisible();

        // Verify messages are still visible and not overlapped
        await expect(webviewPage.locator('.message').first()).toBeVisible();
    });

    test('should handle confirmation for different tool types correctly', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);

        const toolTests = [
            { toolName: EDIT_TOOL_NAME, expectedType: '代码修改待确认' },
            { toolName: WRITE_TOOL_NAME, expectedType: '代码修改待确认' },
            { toolName: BASH_TOOL_NAME, expectedType: '命令执行待确认' },
            { toolName: 'SomeOtherTool', expectedType: '操作待确认' }
        ];

        for (const { toolName, expectedType } of toolTests) {
            // Show confirmation
            await injector.simulateExtensionMessage('showConfirmation', {
                confirmationId: `test_${toolName}`,
                toolName: toolName,
                confirmationType: expectedType,
                toolInput: {}
            });

            // Verify correct confirmation type
            await expect(webviewPage.locator('.confirmation-title')).toHaveText(expectedType);
            await expect(webviewPage.locator('.confirmation-details')).toContainText('工具: ');

            // Dismiss the dialog
            await webviewPage.locator('.confirmation-btn-apply').click();
            await expect(webviewPage.locator('.confirmation-dialog')).not.toBeVisible();
        }
    });

    test('should occupy bottom space like MessageInput instead of overlaying content', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);

        // Add multiple messages to fill up space
        const manyMessages: Message[] = Array.from({ length: 5 }, (_, i) => ({
            id: `msg_many_${i}`,
            role: i % 2 === 0 ? 'user' : 'assistant',
            timestamp: '2024-01-01T00:00:00.000Z',
            blocks: [{ type: 'text', content: `Test message ${i + 1} with some longer content to take up space` }]
        }));

        await injector.updateMessages(manyMessages);

        // Get initial message count (includes any default messages)
        const messageCountBefore = await webviewPage.locator('.message').count();
        
        // Verify last message is visible before confirmation
        await expect(webviewPage.locator('.message').last()).toBeVisible();

        // Show confirmation dialog
        await injector.simulateExtensionMessage('showConfirmation', {
            confirmationId: 'test_space_occupation',
            toolName: EDIT_TOOL_NAME,
            confirmationType: '代码修改待确认',
            toolInput: {}
        });

        // Wait for confirmation to be visible
        await expect(webviewPage.locator('.confirmation-dialog')).toBeVisible();

        // Verify input is hidden (replaced by confirmation)
        await expect(webviewPage.getByTestId('message-input')).not.toBeVisible();

        // All messages should still be accessible and visible (not overlapped)
        const messageCountAfter = await webviewPage.locator('.message').count();
        expect(messageCountAfter).toBe(messageCountBefore); // Same number of messages
        
        // Last message should still be visible and not overlapped by the dialog
        await expect(webviewPage.locator('.message').last()).toBeVisible();

        // Verify confirmation dialog is at the bottom by checking element order
        const chatContainerChildren = await webviewPage.evaluate(() => {
            const chatContainer = document.querySelector('.chat-container');
            return Array.from(chatContainer.children).map(child => child.className);
        });

        // Should have header, messages, and input-area-container (no input when confirmation is shown)
        expect(chatContainerChildren).toEqual([
            'chat-header',
            'messages-container',
            'input-area-container'
        ]);

        // Verify confirmation dialog is inside input-area-container
        await expect(webviewPage.locator('.input-area-container .confirmation-dialog')).toBeVisible();

        // Verify input-area-container is styled consistently with input area
        const containerStyles = await webviewPage.locator('.input-area-container').evaluate(el => {
            const styles = window.getComputedStyle(el);
            return {
                borderTop: styles.borderTop,
                position: styles.position
            };
        });

        // Should use static positioning (not fixed/absolute) and have border-top
        expect(containerStyles.position).toBe('static');
        expect(containerStyles.borderTop).toContain('1px');
        expect(containerStyles.borderTop).toContain('solid');
    });

    test('should prevent user interaction with input while confirmation is shown', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);

        // Verify input is initially visible
        await expect(webviewPage.getByTestId('message-input')).toBeVisible();

        // Show confirmation
        await injector.simulateExtensionMessage('showConfirmation', {
            confirmationId: 'test_input_hidden',
            toolName: EDIT_TOOL_NAME,
            confirmationType: '代码修改待确认',
            toolInput: {}
        });

        // Verify input is hidden
        await expect(webviewPage.getByTestId('message-input')).not.toBeVisible();

        // Verify confirmation dialog is visible
        await expect(webviewPage.locator('.confirmation-dialog')).toBeVisible();

        // Approve confirmation
        await webviewPage.locator('.confirmation-btn-apply').click();

        // Verify input becomes visible again
        await expect(webviewPage.getByTestId('message-input')).toBeVisible();
        await expect(webviewPage.locator('.confirmation-dialog')).not.toBeVisible();
    });

    test('should scroll to bottom when confirmation dialog is shown', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);

        // Add multiple messages to create scrollable content
        const manyMessages: Message[] = Array.from({ length: 10 }, (_, i) => ({
            id: `msg_scroll_${i}`,
            role: i % 2 === 0 ? 'user' : 'assistant',
            timestamp: '2024-01-01T00:00:00.000Z',
            blocks: [{ type: 'text', content: `Message ${i + 1} with enough content to make the message list scrollable and ensure we need to scroll down` }]
        }));
        await injector.updateMessages(manyMessages);

        const container = webviewPage.locator('.messages-container');

        // Wait for messages to render and verify content is scrollable
        await expect(async () => {
            const dimsBefore = await container.evaluate(el => el.scrollHeight - el.clientHeight);
            expect(dimsBefore).toBeGreaterThan(0);
        }).toPass();

        // Scroll away from bottom to simulate user reading history
        await container.evaluate(el => {
            el.scrollTop = 0;
            el.dispatchEvent(new Event('scroll', { bubbles: true }));
        });

        // Capture scroll position before confirmation
        const scrollTopBefore = await container.evaluate(el => el.scrollTop);
        expect(scrollTopBefore).toBe(0);

        // Show confirmation dialog
        await injector.simulateExtensionMessage('showConfirmation', {
            confirmationId: 'test_scroll_on_show',
            toolName: EDIT_TOOL_NAME,
            confirmationType: '代码修改待确认',
            toolInput: {}
        });

        // Wait for confirmation to be visible
        await expect(webviewPage.locator('.confirmation-dialog')).toBeVisible();

        // Wait for scroll position to change (proving scrollToBottom was triggered)
        await expect(async () => {
            const currentScrollTop = await container.evaluate(el => el.scrollTop);
            expect(currentScrollTop).toBeGreaterThan(scrollTopBefore);
        }).toPass({ timeout: 2000 });
    });

    test('should focus input and scroll to bottom after confirmation is completed', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);

        // Simulate confirmation request
        await injector.simulateExtensionMessage('showConfirmation', {
            confirmationId: 'test_focus_scroll',
            toolName: EDIT_TOOL_NAME,
            confirmationType: '代码修改待确认',
            toolInput: {}
        });

        // Verify input is hidden
        await expect(webviewPage.getByTestId('message-input')).not.toBeVisible();

        // Approve confirmation
        await webviewPage.locator('.confirmation-btn-apply').click();

        // Verify input is visible again
        const input = webviewPage.getByTestId('message-input');
        await expect(input).toBeVisible();

        // Simulate focusInput and scrollToBottom commands from extension
        await injector.simulateExtensionMessage('focusInput', {});
        await injector.simulateExtensionMessage('scrollToBottom', {});

        // Verify input is focused
        await expect(input).toBeFocused();

        // Verify message list is scrolled to bottom
        const container = webviewPage.locator('.messages-container');
        const isAtBottom = await container.evaluate(el => {
            return Math.abs(el.scrollTop + el.clientHeight - el.scrollHeight) < 5;
        });
        expect(isAtBottom).toBe(true);
    });

    test('should show auto-confirm button for MCP tools with correct text', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);

        // Simulate confirmation request for MCP tool
        await injector.simulateExtensionMessage('showConfirmation', {
            confirmationId: 'test_mcp_confirmation',
            toolName: 'mcp__fetch__web_fetch',
            confirmationType: '操作待确认',
            toolInput: { url: 'https://example.com' }
        });

        const confirmationDialog = webviewPage.locator('.confirmation-dialog');
        await expect(confirmationDialog).toBeVisible();

        // Verify apply button shows "批准并继续"
        await expect(webviewPage.locator('.confirmation-btn-apply')).toHaveText('批准并继续');

        // Verify auto button is visible with correct text
        const autoBtn = webviewPage.locator('.confirmation-btn-auto');
        await expect(autoBtn).toBeVisible();
        await expect(autoBtn).toHaveText('是，且不再询问：mcp__fetch__web_fetch');

        // Verify feedback button is visible
        await expect(webviewPage.locator('.confirmation-btn-feedback')).toHaveText('提供反馈');

        // Click auto-confirm and verify decision
        await injector.clearMessageLog();
        await autoBtn.click();

        const sentMessages = await injector.getMessagesSentToExtension();
        expect(sentMessages).toHaveLength(1);
        expect(sentMessages[0]).toEqual({
            command: 'confirmationResponse',
            confirmationId: 'test_mcp_confirmation',
            approved: true,
            decision: {
                behavior: 'allow',
                newPermissionRule: 'mcp__fetch__web_fetch'
            }
        });
    });

    test('should send allow decision for MCP tools when clicking apply', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);

        // Clear message log before starting
        await injector.clearMessageLog();

        // Simulate confirmation request for MCP tool
        await injector.simulateExtensionMessage('showConfirmation', {
            confirmationId: 'test_mcp_apply',
            toolName: 'mcp__tavily__search',
            confirmationType: '操作待确认',
            toolInput: { query: 'test query' }
        });

        // Click apply button
        await webviewPage.locator('.confirmation-btn-apply').click();

        const sentMessages = await injector.getMessagesSentToExtension();
        expect(sentMessages).toHaveLength(1);
        expect(sentMessages[0]).toEqual({
            command: 'confirmationResponse',
            confirmationId: 'test_mcp_apply',
            approved: true,
            decision: {
                behavior: 'allow'
            }
        });
    });

    test('should show file path for write and edit tool confirmations', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);

        // Test Write tool
        await injector.simulateExtensionMessage('showConfirmation', {
            confirmationId: 'test_write_file_path',
            toolName: WRITE_TOOL_NAME,
            confirmationType: '代码修改待确认',
            toolInput: { file_path: 'src/utils/helper.ts', content: 'export const x = 1;' }
        });

        const confirmationDialog = webviewPage.locator('.confirmation-dialog');
        await expect(confirmationDialog).toBeVisible();
        await expect(webviewPage.locator('.confirmation-file-path')).toContainText('src/utils/helper.ts');

        // Approve to dismiss
        await webviewPage.locator('.confirmation-btn-apply').click();
        await expect(confirmationDialog).not.toBeVisible();

        // Test Edit tool
        await injector.simulateExtensionMessage('showConfirmation', {
            confirmationId: 'test_edit_file_path',
            toolName: EDIT_TOOL_NAME,
            confirmationType: '代码修改待确认',
            toolInput: { file_path: 'src/components/App.tsx', old_string: 'old', new_string: 'new' }
        });

        await expect(confirmationDialog).toBeVisible();
        await expect(webviewPage.locator('.confirmation-file-path')).toContainText('src/components/App.tsx');
    });
});