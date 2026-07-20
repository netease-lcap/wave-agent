import { test } from '../utils/webviewTestHarness.js';
import { MessageInjector } from '../utils/messageInjector.js';
import { type Message, type SessionMetadata } from 'wave-agent-sdk';

test.describe('Product Specification Screenshots - Chat Header', () => {
    test('capture redesigned chat header, session search popup and more menu', async ({
        webviewPage
    }) => {
        const injector = new MessageInjector(webviewPage);

        // 模拟 VS Code 侧边栏宽度
        await webviewPage.setViewportSize({ width: 400, height: 800 });

        const now = Date.now();
        const sessions: SessionMetadata[] = [
            {
                id: 'session-1',
                sessionType: 'main',
                workdir: '/home/dev/projects/nebula-platform',
                createdAt: new Date(now - 1000 * 60 * 60),
                lastActiveAt: new Date(now - 1000 * 60 * 30),
                latestTotalTokens: 15420,
                firstMessage: '帮我分析支付模块的代码结构'
            },
            {
                id: 'session-2',
                sessionType: 'main',
                workdir: '/home/dev/projects/nebula-platform',
                createdAt: new Date(now - 1000 * 60 * 60 * 3),
                lastActiveAt: new Date(now - 1000 * 60 * 60 * 2),
                latestTotalTokens: 32800,
                firstMessage: '重构支付服务，拆分下单与退款逻辑'
            },
            {
                id: 'session-3',
                sessionType: 'main',
                workdir: '/home/dev/projects/nebula-platform',
                createdAt: new Date(now - 1000 * 60 * 60 * 48),
                lastActiveAt: new Date(now - 1000 * 60 * 60 * 24),
                latestTotalTokens: 8600,
                firstMessage: '为登录页面补充单元测试'
            }
        ];

        const messages: Message[] = [
            {
                id: 'msg_header_user',
                role: 'user',
                timestamp: '2025-07-09T10:30:00.000Z',
                blocks: [{ type: 'text', content: '帮我分析支付模块的代码结构' }]
            },
            {
                id: 'msg_header_assistant',
                role: 'assistant',
                timestamp: '2025-07-09T10:30:05.000Z',
                blocks: [
                    {
                        type: 'text',
                        content: '好的，我先梳理支付模块的目录结构，然后分析核心服务的职责划分。'
                    }
                ]
            }
        ];

        // 初始化：已登录、含会话与消息，含 serverUrl 供“企业控制台”使用
        await injector.simulateExtensionMessage('setInitialState', {
            messages,
            isStreaming: false,
            isAuthenticated: true,
            sessions,
            session: sessions[0],
            configurationData: {
                apiKey: 'sk-ant-api03-CXB9pH2k...mH8wQz',
                baseURL: 'https://api.anthropic.com/v1',
                model: 'claude-sonnet-4-20250514',
                fastModel: 'claude-haiku-4-20250514',
                serverUrl: 'https://console.wave.example.com'
            },
            permissionMode: 'default'
        });

        // 1. 重新设计后的 Chat Header（标题 + 新建/历史/更多 三个图标）
        await webviewPage.waitForSelector('[data-testid="chat-header"]');
        await webviewPage
            .locator('[data-testid="chat-header"]')
            .screenshot({ path: '../../docs/public/screenshots/spec-chat-header.png' });

        // 2. 历史会话搜索弹窗（搜索关键词 + 命中高亮）
        await webviewPage.getByTestId('history-btn').click();
        await webviewPage.waitForSelector('[data-testid="session-list-popup"]');
        await webviewPage.fill('.session-list-search', '支付');
        await webviewPage.waitForSelector('.session-list-highlight');
        await webviewPage.screenshot({
            path: '../../docs/public/screenshots/spec-session-search.png'
        });
        await webviewPage.keyboard.press('Escape');
        await webviewPage.waitForSelector('[data-testid="session-list-popup"]', {
            state: 'hidden'
        });

        // 3. 更多菜单（设置 / 企业控制台 / 退出登录）
        await webviewPage.getByTestId('more-btn').click();
        await webviewPage.waitForSelector('[data-testid="more-menu"]');
        await webviewPage.screenshot({
            path: '../../docs/public/screenshots/spec-more-menu.png'
        });
        await webviewPage.keyboard.press('Escape');
    });
});
