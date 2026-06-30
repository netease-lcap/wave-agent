import { test, expect } from '../utils/webviewTestHarness.js';
import { MessageInjector } from '../utils/messageInjector.js';
import { UIStateVerifier } from '../utils/uiStateVerifier.js';
import { MockDataGenerator } from '../fixtures/mockData.js';

test.describe('Product Spec: Rewind', () => {
    test('should capture rewind button screenshot', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);
        const ui = new UIStateVerifier(webviewPage);

        // Setup a conversation
        const messages = [
            MockDataGenerator.createUserMessage('帮我重构一下这个函数'),
            MockDataGenerator.createAssistantMessage('好的，我来看看这个函数...'),
            MockDataGenerator.createUserMessage('再帮我写个测试用例')
        ];
        await injector.updateMessages(messages);
        await injector.endStreaming();

        // Hover over the first user message to show the rewind button, then hover the button to show tooltip
        const firstUserMessage = ui.userMessages.first();
        await firstUserMessage.hover();
        
        const rewindBtn = firstUserMessage.locator('.message-action-btn');
        await expect(rewindBtn).toBeVisible();
        await rewindBtn.hover();

        // Take screenshot of the message list showing the rewind button with tooltip
        await webviewPage.screenshot({
            path: 'docs/public/screenshots/spec-rewind-button.png',
            clip: await ui.messagesContainer.boundingBox() || undefined
        });

        // Take a full screenshot showing the context
        await webviewPage.screenshot({
            path: 'docs/public/screenshots/spec-rewind-context.png'
        });
    });
});
