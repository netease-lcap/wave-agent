import { test, expect } from '../utils/webviewTestHarness.js';
import { MessageInjector } from '../utils/messageInjector.js';
import { MockDataGenerator } from '../fixtures/mockData.js';
import { screenshotWebp, elementScreenshotWebp } from '../utils/screenshot.js';

test.describe('Product Spec: /btw side question', () => {
    test('should capture the /btw panel with a markdown answer', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);

        // Setup a conversation so the panel shows above a real chat
        const messages = [
            MockDataGenerator.createUserMessage('帮我看下 PaymentService 的并发问题'),
            MockDataGenerator.createAssistantMessage('我已经分析了 PaymentService 的代码，发现 `processPayment` 方法中存在竞态条件，建议改用乐观锁...')
        ];
        await injector.updateMessages(messages);
        await injector.endStreaming();

        // Type /btw <question> and send it — no chat message is posted
        await webviewPage.focus('[data-testid="message-input"]');
        await webviewPage.keyboard.type('/btw 乐观锁的实现思路是什么？');
        await webviewPage.keyboard.press('Enter');

        // Wait for the askBtw RPC to be sent to the extension
        await webviewPage.waitForFunction(() => {
            const msgs = window.getTestMessages ? window.getTestMessages() : [];
            return msgs.some((m) => m.command === 'askBtw');
        });

        // Inject the side answer (markdown)
        await injector.simulateExtensionMessage('btwResponse', {
            question: '乐观锁的实现思路是什么？',
            answer: '**乐观锁**的核心思路是：读取时不加锁，更新时通过版本号（`version`）或时间戳校验数据是否被他人修改。\n\n- 读取数据并记录版本号\n- 更新时 `SET version = version + 1 WHERE version = 旧值`\n- 受影响行数为 0 时说明已被修改，重试或放弃\n\n相比悲观锁，乐观锁在低冲突场景下吞吐更高，适合读多写少的业务。'
        });

        // Panel shows the answer, chat history stays untouched
        await expect(webviewPage.locator('[data-testid="btw-panel-answer"]')).toBeVisible();
        await expect(webviewPage.locator('[data-testid="btw-panel-answer"]')).toContainText('乐观锁');

        // Full screenshot showing the panel above the input
        await screenshotWebp(webviewPage, '../../docs/public/screenshots/spec-btw-panel.webp');

        // Element screenshot of the panel alone
        await elementScreenshotWebp(
            webviewPage.locator('[data-testid="btw-panel"]'),
            '../../docs/public/screenshots/spec-btw-panel-element.webp'
        );
    });

    test('should capture the bare /btw usage hint', async ({ webviewPage }) => {
        // Type bare /btw and send it — shows usage, sends no RPC
        await webviewPage.focus('[data-testid="message-input"]');
        await webviewPage.keyboard.type('/btw');
        await webviewPage.keyboard.press('Enter');

        await expect(webviewPage.locator('[data-testid="btw-panel"]')).toBeVisible();
        await expect(webviewPage.locator('[data-testid="btw-panel-answer"]')).toContainText('Usage: /btw <your question>');

        await elementScreenshotWebp(
            webviewPage.locator('[data-testid="btw-panel"]'),
            '../../docs/public/screenshots/spec-btw-usage.webp'
        );
    });
});
