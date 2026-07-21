import { test, expect } from '../utils/webviewTestHarness.js';
import { MessageInjector } from '../utils/messageInjector.js';
import { MockDataGenerator } from '../fixtures/mockData.js';

// Realistic Chinese dev-task queue messages (varying length; at least one long enough to ellipsize)
const QUEUE = [
    { id: 'mq-0', content: '顺便帮乐观锁中间件补一组单元测试，覆盖并发写入时的版本号冲突场景' },
    { id: 'mq-1', content: '把 PaymentService 里的重复重试逻辑抽成一个通用的指数退避工具函数' },
    { id: 'mq-2', content: '给订单状态机加上非法状态流转的日志告警，方便线上排查' },
    { id: 'mq-3', content: '梳理一下这次改动涉及的数据库迁移，确认回滚脚本是否完整，并在 CI 里加一个迁移演练的 job，避免上线时才发现字段不兼容导致回滚困难的问题' },
    { id: 'mq-4', content: '更新 README 里的本地启动说明，补上新增的环境变量' },
    { id: 'mq-5', content: '排查一下压测时偶发的连接池耗尽，看看是不是慢查询没释放连接' },
    { id: 'mq-6', content: '把这次分析结论整理成一份简短的技术方案文档' }
];

test.describe('Product Specification Screenshots - Message Queuing', () => {
    test('capture message queuing features', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);

        // Set viewport size for better screenshots (simulating VS Code sidebar)
        await webviewPage.setViewportSize({ width: 400, height: 800 });

        // Provide initial state (AI is streaming a response)
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

        // 1. During streaming the bottom bar shows the abort (停止) button; the
        //    send/queue button is not rendered. Typing while streaming still
        //    queues the message (handled by the extension).
        await webviewPage.focus('[data-testid="message-input"]');
        await webviewPage.keyboard.type('顺便帮乐观锁中间件补一组单元测试，覆盖并发写入时的版本号冲突场景');

        await expect(webviewPage.getByTestId('send-btn')).toHaveCount(0);
        const abortBtn = webviewPage.getByTestId('abort-btn');
        await expect(abortBtn).toBeVisible();
        await expect(abortBtn).toHaveAttribute('aria-label', '停止');
        await expect(abortBtn.locator('.abort-glyph')).toBeVisible();

        await webviewPage.locator('.input-container').screenshot({ path: '../../docs/public/screenshots/spec-queue-button.png' });

        // Clear input to simulate real behavior (input cleared after message queued)
        await webviewPage.fill('[data-testid="message-input"]', '');

        // Inject a multi-item queue
        await injector.updateQueue(QUEUE);

        const queuePanel = webviewPage.getByTestId('queued-message-list');
        await expect(queuePanel).toBeVisible();
        await expect(queuePanel).toContainText(`消息队列 (${QUEUE.length})`);

        // 2. Collapsed state (default): only the first item is visible
        await expect(webviewPage.getByTestId('queued-item-mq-0')).toBeVisible();
        await expect(webviewPage.getByTestId('queued-item-mq-1')).toHaveCount(0);
        await webviewPage.screenshot({ path: '../../docs/public/screenshots/spec-queue-collapsed.png' });

        // 3. Expanded state: click header to expand, multiple single-line items visible
        await queuePanel.locator('.queued-message-list-header').click();
        await expect(webviewPage.getByTestId('queued-item-mq-1')).toBeVisible();
        await expect(webviewPage.getByTestId('queued-item-mq-6')).toBeVisible();

        // Each item exposes the inline edit / ↑立即发送 / delete SVG action buttons
        await expect(webviewPage.getByTestId('queued-edit-mq-1')).toBeVisible();
        const sendNowBtn = webviewPage.getByTestId('queued-send-mq-1');
        await expect(sendNowBtn).toBeVisible();
        await expect(sendNowBtn).toHaveAttribute('aria-label', '立即发送');
        await expect(sendNowBtn.locator('svg')).toBeVisible();
        await expect(webviewPage.getByTestId('queued-delete-mq-1')).toBeVisible();

        await webviewPage.screenshot({ path: '../../docs/public/screenshots/spec-queued-message.png' });

        // 4. Editing state: click a message's edit button -> the read-only inline
        //    chip "编辑队列消息" appears inside the input, and the item is marked editing
        await webviewPage.getByTestId('queued-edit-mq-1').click({ force: true });
        const editChip = webviewPage.getByTestId('message-input').locator('.queued-edit-chip');
        await expect(editChip).toBeVisible();
        await expect(editChip).toContainText('编辑队列消息');
        await expect(webviewPage.getByTestId('queued-item-mq-1')).toHaveClass(/editing/);
        await webviewPage.screenshot({ path: '../../docs/public/screenshots/spec-queue-editing.png' });
    });
});
