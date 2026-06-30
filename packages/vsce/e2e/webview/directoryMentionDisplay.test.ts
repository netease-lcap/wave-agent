import { test, expect } from '../utils/webviewTestHarness.js';
import { MessageInjector } from '../utils/messageInjector.js';
import { UIStateVerifier } from '../utils/uiStateVerifier.js';
import { MockDataGenerator } from '../fixtures/mockData.js';

test.describe('Directory Mention Display', () => {
    test('should correctly display directory with trailing slash in message list', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);
        const ui = new UIStateVerifier(webviewPage);

        // Clear message log
        await injector.clearMessageLog();

        // Simulate a user message with a directory mention containing a trailing slash
        const messages = [
            MockDataGenerator.createUserMessage('Check this directory: [@file:.git/]')
        ];

        await injector.updateMessages(messages);

        // Verify the message is displayed
        // Note: UIStateVerifier.verifyMessageCount includes the welcome message
        await ui.verifyMessageCount(2); 

        // Check if the ContextTag is rendered correctly
        const userMessage = webviewPage.locator('.message.user').nth(0);
        const contextTag = userMessage.locator('.context-tag');
        
        await expect(contextTag).toBeVisible();
        
        // The name should be '.git' (trailing slash removed by our fix)
        const tagName = contextTag.locator('.tag-name');
        await expect(tagName).toHaveText('.git');
        
        // Verify the data-path attribute still has the trailing slash
        await expect(contextTag).toHaveAttribute('data-path', '.git/');
    });

    test('should correctly display nested directory with trailing slash', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);

        await injector.clearMessageLog();

        const messages = [
            MockDataGenerator.createUserMessage('Nested dir: [@file:src/components/]')
        ];

        await injector.updateMessages(messages);

        const userMessage = webviewPage.locator('.message.user').nth(0);
        const contextTag = userMessage.locator('.context-tag');
        
        await expect(contextTag).toBeVisible();
        
        // The name should be 'components'
        const tagName = contextTag.locator('.tag-name');
        await expect(tagName).toHaveText('components');
        
        await expect(contextTag).toHaveAttribute('data-path', 'src/components/');
    });
});
