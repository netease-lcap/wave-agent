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
                MockDataGenerator.createUserMessage('请帮我重构这个函数'),
                MockDataGenerator.createAssistantMessage('好的，我正在分析代码并准备重构建议...')
            ],
            isStreaming: true,
            sessions: [],
            configurationData: {
                apiKey: 'sk-xxxxxxxxxxxxxxxx',
                baseURL: 'https://api.openai.com/v1',
                model: 'gpt-4',
                fastModel: 'gpt-3.5-turbo'
            },
            permissionMode: 'default'
        });

        // 1. Show "Add to Queue" button in input
        await webviewPage.focus('[data-testid="message-input"]');
        await webviewPage.keyboard.type('顺便帮我写个测试用例');
        
        // Wait for the button to update and focus it for screenshot
        const sendBtn = webviewPage.getByTestId('send-btn');
        await expect(sendBtn).toHaveAttribute('aria-label', '加入队列');
        await sendBtn.focus();
        
        // Take screenshot of the input area with "Add to Queue" button
        await webviewPage.locator('.input-container').screenshot({ path: 'docs/public/screenshots/spec-queue-button.png' });

        // 2. Show queued message in the list with tags
        await injector.simulateExtensionMessage('updateQueue', {
            queue: [
                { 
                    content: '顺便帮我写个测试用例，参考 [@file:src/utils.ts] 和 [image1]',
                    images: [{ path: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', mimeType: 'image/png' }]
                }
            ]
        });

        // Clear input to simulate real behavior (input cleared after message queued)
        await webviewPage.fill('[data-testid="message-input"]', '');
        
        // Wait for the queued message to appear in the queue panel
        const queuePanel = webviewPage.getByTestId('queued-message-list');
        await expect(queuePanel).toBeVisible();
        await expect(queuePanel).toContainText('utils.ts');
        await expect(queuePanel).toContainText('图片 1');
        
        // Take screenshot of the message list showing the queued message with tags
        await webviewPage.screenshot({ path: 'docs/public/screenshots/spec-queued-message.png' });
    });
});
