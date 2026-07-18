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
            MockDataGenerator.createUserMessage('帮我分析 PaymentService 的并发问题，看看有没有竞态条件'),
            MockDataGenerator.createAssistantMessage('我已经分析了 PaymentService 的代码，发现 `processPayment` 方法中存在竞态条件。当前的悲观锁实现会导致高并发下性能下降，建议改用乐观锁...'),
            MockDataGenerator.createUserMessage('好的，请为乐观锁实现编写单元测试，覆盖并发冲突场景')
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
            path: '../../docs/public/screenshots/spec-rewind-button.png',
            clip: await ui.messagesContainer.boundingBox() || undefined
        });

        // Take a full screenshot showing the context
        await webviewPage.screenshot({
            path: '../../docs/public/screenshots/spec-rewind-context.png'
        });
    });
});
