import { test, expect } from '../utils/webviewTestHarness.js';
import { MessageInjector } from '../utils/messageInjector.js';
import { MockDataGenerator } from '../fixtures/mockData.js';

test.describe('Product Specification Screenshots - Message Queuing', () => {
    test('capture message queuing features', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);

        // Set viewport size for better screenshots (simulating VS Code sidebar)
        await webviewPage.setViewportSize({ width: 400, height: 800 });

        // Provide initial state
        await injector.simulateExtensionMessage('setInitialState', {
            messages: [
                MockDataGenerator.createUserMessage('帮我分析 PaymentService 的分布式事务实现，看看有没有竞态条件'),
                MockDataGenerator.createAssistantMessage('好的，我正在扫描支付服务代码，分析事务边界和并发控制机制...')
            ],
            isStreaming: true,
            sessions: [],
            configurationData: {
                apiKey: 'sk-ant-api03-CXB9pH2k...mH8wQz',
                baseURL: 'https://api.anthropic.com/v1',
                model: 'claude-sonnet-4-20250514',
                fastModel: 'claude-haiku-4-20250514'
            },
            permissionMode: 'default'
        });

        // 1. Show "Add to Queue" button in input
        await webviewPage.focus('[data-testid="message-input"]');
        await webviewPage.keyboard.type('顺便帮我写一个乐观锁中间件的单元测试，参考 [file:src/services/payment/PaymentService.ts] 和 [image1]');
        
        // Wait for the button to update and focus it for screenshot
        const sendBtn = webviewPage.getByTestId('send-btn');
        await expect(sendBtn).toHaveAttribute('aria-label', '加入队列');
        await sendBtn.focus();
        
        // Take screenshot of the input area with "Add to Queue" button
        await webviewPage.locator('.input-container').screenshot({ path: '../../docs/public/screenshots/spec-queue-button.png' });

        // 2. Show queued message in the list with tags
        await injector.simulateExtensionMessage('updateQueue', {
            queue: [
                { 
                    content: '顺便帮我写一个乐观锁中间件的单元测试，参考 [file:src/services/payment/PaymentService.ts] 和 [image1]',
                    images: [{ path: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', mimeType: 'image/png' }]
                }
            ]
        });

        // Clear input to simulate real behavior (input cleared after message queued)
        await webviewPage.fill('[data-testid="message-input"]', '');
        
        // Wait for the queued message to appear in the queue panel
        const queuePanel = webviewPage.getByTestId('queued-message-list');
        await expect(queuePanel).toBeVisible();
        await expect(queuePanel).toContainText('PaymentService.ts');
        await expect(queuePanel).toContainText('图片 1');
        
        // Take screenshot of the message list showing the queued message with tags
        await webviewPage.screenshot({ path: '../../docs/public/screenshots/spec-queued-message.png' });
    });
});
