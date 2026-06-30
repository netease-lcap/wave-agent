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
            { prompt: '帮我重构一下这个组件，用函数式写法', timestamp: 1774325357000 },
            { prompt: '创建一个新文件 src/utils/format.ts，导出时间格式化函数', timestamp: 1774325174000 },
            { prompt: '/speckit:constitution 所有模板必须用中文编写', timestamp: 1774851151833 }
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
            path: 'docs/public/screenshots/spec-history-search.png'
        });

        // 6. Take a full screenshot showing the context
        await webviewPage.screenshot({
            path: 'docs/public/screenshots/spec-history-search-context.png'
        });
    });
});
