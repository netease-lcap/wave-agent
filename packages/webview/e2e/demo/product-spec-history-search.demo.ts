import { test, expect } from '../utils/webviewTestHarness.js';
import { MessageInjector } from '../utils/messageInjector.js';

test.describe('Product Spec: History Search', () => {
    test('should capture history search popup screenshot', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);

        // 1. Focus input
        const messageInput = webviewPage.getByTestId('message-input');
        await messageInput.focus();

        // 2. Press Ctrl+R
        await webviewPage.keyboard.press('Control+r');

        // 3. Simulate history response from extension
        const mockHistory = [
            { prompt: '为 PaymentService 添加分布式事务支持，使用 Saga 模式', timestamp: 1752052800000 },
            { prompt: '分析 src/services/payment 目录下的竞态条件，生成修复方案', timestamp: 1752051000000 },
            { prompt: '/review 审查 PaymentController.ts 中的安全性问题', timestamp: 1751966400000 }
        ];

        await injector.simulateExtensionMessage('historyResponse', {
            history: mockHistory
        });

        // 4. Wait for popup to be visible and loading to finish
        const popup = webviewPage.getByTestId('history-search-popup');
        await expect(popup).toBeVisible();
        // Wait for the loading spinner to disappear (data rendered)
        await expect(popup.getByText('正在加载...')).toBeHidden();

        // 5. Take screenshot of the whole webview to show the popup in context
        await webviewPage.screenshot({
            path: '../../docs/public/screenshots/spec-history-search.png'
        });

        // 6. Take a full screenshot showing the context
        await webviewPage.screenshot({
            path: '../../docs/public/screenshots/spec-history-search-context.png'
        });
    });
});
