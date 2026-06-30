/* eslint-disable @typescript-eslint/no-explicit-any */
import { test, expect } from '../utils/webviewTestHarness.js';
import { MessageInjector } from '../utils/messageInjector.js';
import { UIStateVerifier } from '../utils/uiStateVerifier.js';
import { Message } from 'wave-agent-sdk';

test.describe('Selection Feature (Inline Tags)', () => {
    test('should insert inline selection tag and render it in history', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);
        const ui = new UIStateVerifier(webviewPage);

        // 1. Simulate "Add to Wave" command from extension
        const selection = {
            filePath: '/path/to/src/file.ts',
            fileName: 'src/file.ts',
            startLine: 10,
            endLine: 20,
            lineCount: 11,
            selectedText: 'const x = 1;\nconst y = 2;',
            isEmpty: false
        };

        await webviewPage.evaluate((sel) => {
            window.postMessage({
                command: 'addSelectionToInput',
                selection: sel
            }, '*');
        }, selection);

        // 2. Verify inline tag is inserted in the input
        const input = webviewPage.locator('#messageInput');
        const inlineTag = input.locator('.context-tag-container[data-is-selection="true"]');
        await expect(inlineTag).toBeVisible();
        await expect(inlineTag).toContainText('file.ts#10-20');
        
        // Verify old selection tag is NOT visible
        const oldSelectionTag = webviewPage.locator('.selection-tag');
        await expect(oldSelectionTag).not.toBeVisible();

        // 3. Type some text and send
        await ui.typeMessage('Check this code: ');
        
        await injector.clearMessageLog();
        await ui.clickSend();
        
        // 4. Verify the markdown sent to extension
        const sentMessages = await injector.getMessagesSentToExtension();
        const sendMessage = sentMessages.find(m => m.command === 'sendMessage');
        expect(sendMessage).toBeDefined();
        // The markdown should contain the selection placeholder
        // Use a more flexible check as the order might depend on where the cursor was
        expect(sendMessage.text).toContain('[Selection: /path/to/src/file.ts|file.ts#10-20]');
        // Selection property should be undefined as it's now inline
        expect(sendMessage.selection).toBeUndefined();

        // 5. Simulate message in history with selection tag
        const messages: Message[] = [
            {
                id: 'msg_sel_inline',
                role: 'user',
                timestamp: '2024-01-01T00:00:00.000Z',
                blocks: [
                    { 
                        type: 'text', 
                        content: 'Check this code: [Selection: /path/to/src/file.ts|file.ts#10-20]' 
                    }
                ]
            }
        ];
        await injector.updateMessages(messages);
        
        // 6. Verify message rendering
        const messageElement = webviewPage.locator('.message.user').last();
        const renderedTag = messageElement.locator('.context-tag');
        await expect(renderedTag).toBeVisible();
        await expect(renderedTag).toContainText('file.ts#10-20');
        
        // Verify old block-level reference is NOT visible
        const selectionRef = webviewPage.locator('.selection-reference');
        await expect(selectionRef).not.toBeVisible();

        // 7. Test clicking the tag
        await injector.clearMessageLog();
        await renderedTag.click();

        // Wait for message to be sent
        await webviewPage.waitForFunction(() => {
            const messages = (window as any).getTestMessages ? (window as any).getTestMessages() : [];
            return messages.some((m: any) => m.command === 'openFile');
        }, { timeout: 5000 });

        const clickMessages = await injector.getMessagesSentToExtension();
        const openFileMsg = clickMessages.find(m => m.command === 'openFile');
        expect(openFileMsg).toBeDefined();
        expect(openFileMsg.path).toBe('/path/to/src/file.ts');
        expect(openFileMsg.startLine).toBe(10);
        expect(openFileMsg.endLine).toBe(20);
    });

    test('should be backward compatible with old selection format', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);
        
        const messages: Message[] = [
            {
                id: 'msg_sel_old',
                role: 'user',
                timestamp: '2024-01-01T00:00:00.000Z',
                blocks: [
                    { 
                        type: 'text', 
                        content: 'Old format: [Selection: file.ts#10-20]' 
                    }
                ]
            }
        ];
        await injector.updateMessages(messages);
        
        const messageElement = webviewPage.locator('.message.user').last();
        const renderedTag = messageElement.locator('.context-tag');
        await expect(renderedTag).toBeVisible();
        await expect(renderedTag).toContainText('file.ts#10-20');
        
        // Test clicking old format (path will be fileName)
        await injector.clearMessageLog();
        await renderedTag.click();
        
        // Wait for message to be sent
        await webviewPage.waitForFunction(() => {
            const messages = (window as any).getTestMessages ? (window as any).getTestMessages() : [];
            return messages.some((m: any) => m.command === 'openFile');
        }, { timeout: 5000 });

        const clickMessages = await injector.getMessagesSentToExtension();
        const openFileMsg = clickMessages.find(m => m.command === 'openFile');
        expect(openFileMsg).toBeDefined();
        expect(openFileMsg.path).toBe('file.ts');
    });
});
