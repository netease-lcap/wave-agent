import { test } from '../utils/webviewTestHarness.js';
import { MessageInjector } from '../utils/messageInjector.js';
import { MockDataGenerator } from '../fixtures/mockData.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
    type Message,
    type SessionMetadata
} from 'wave-agent-sdk';

test.describe('Product Specification Screenshots - Rich Content', () => {
    test('capture rich content features', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);

        // Set viewport size for better screenshots (simulating VS Code sidebar)
        await webviewPage.setViewportSize({ width: 400, height: 800 });

        // Provide initial state with valid configuration
        await injector.simulateExtensionMessage('setInitialState', {
            messages: [],
            isStreaming: false,
            sessions: [],
            configurationData: {
                apiKey: 'sk-ant-api03-CXB9pH2k...mH8wQz',
                baseURL: 'https://api.anthropic.com/v1',
                model: 'claude-sonnet-4-20250514',
                fastModel: 'claude-haiku-4-20250514'
            },
            permissionMode: 'default'
        });

        // 13. Inline Context Tags (Mentions)
        await webviewPage.focus('[data-testid="message-input"]');
        await webviewPage.keyboard.press('Control+A');
        await webviewPage.keyboard.press('Backspace');
        
        // 13a. Insert Folder Tag
        await webviewPage.keyboard.type('@');

        // Capture the actual requestId from the message log
        const getLatestRequestId = async () => {
            return await webviewPage.evaluate(() => {
                const messages = window.getTestMessages ? window.getTestMessages() : [];
                const reqs = messages.filter((m) => m.command === 'requestFileSuggestions');
                return reqs.length > 0 ? reqs[reqs.length - 1].requestId : 'fallback-id';
            });
        };

        // Wait for the debounced requestFileSuggestions request
        await injector.waitForFileSuggestionRequest();

        await injector.simulateExtensionMessage('fileSuggestionsResponse', {
            requestId: await getLatestRequestId(),
            filterText: '',
            suggestions: [
                { path: 'src', relativePath: 'src', name: 'src', icon: 'codicon-folder', isDirectory: true }
            ]
        });
        await webviewPage.waitForSelector('.suggestion-item', { state: 'visible' });
        await webviewPage.keyboard.press('ArrowDown');
        await webviewPage.keyboard.press('Enter');

        await webviewPage.keyboard.type(' 这是文本 ');

        // 13b. Insert File Tag
        const countBeforeSecondAt = await injector.getMessageCount();
        await webviewPage.keyboard.type('@');
        await injector.waitForFileSuggestionRequest(2000, countBeforeSecondAt);

        await injector.simulateExtensionMessage('fileSuggestionsResponse', {
            requestId: await getLatestRequestId(),
            filterText: '',
            suggestions: [
                { path: 'src/main.ts', relativePath: 'src/main.ts', name: 'main.ts', icon: 'codicon-file-code', isDirectory: false }
            ]
        });
        await webviewPage.waitForSelector('.suggestion-item', { state: 'visible' });
        await webviewPage.keyboard.press('ArrowDown');
        await webviewPage.keyboard.press('Enter');

        await webviewPage.keyboard.type(' 这是图片 ');

        // 13c. Insert Image Tag (via paste)
        const logoPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'docs', 'public', 'LOGO.png');
        const logoBase64 = fs.readFileSync(logoPath, { encoding: 'base64' });
        const logoDataUrl = `data:image/png;base64,${logoBase64}`;

        await webviewPage.evaluate(async (dataUrl) => {
            const res = await fetch(dataUrl);
            const blob = await res.blob();
            const file = new File([blob], 'LOGO.png', { type: 'image/png' });
            
            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(file);
            
            const event = new ClipboardEvent('paste', {
                clipboardData: dataTransfer,
                bubbles: true,
                cancelable: true
            });
            document.getElementById('messageInput')?.dispatchEvent(event);
        }, logoDataUrl);

        // Wait for all tags to be rendered
        await webviewPage.waitForFunction(() => {
            return document.querySelectorAll('.context-tag').length >= 3;
        }, { timeout: 5000 });
        
        await webviewPage.locator('.input-container').screenshot({ path: '../../docs/public/screenshots/spec-inline-mentions.png' });

        // 13d. Image Preview Modal
        const imageTag = webviewPage.locator('.context-tag.is-image');
        await imageTag.click();
        await webviewPage.waitForSelector('.image-preview-modal', { state: 'visible' });
        await webviewPage.screenshot({ path: '../../docs/public/screenshots/spec-image-preview.png' });
        
        // Close modal
        await webviewPage.click('.image-preview-close');
        await webviewPage.waitForSelector('.image-preview-modal', { state: 'hidden' });

        // 13b. Message List with Inline Tags
        await injector.updateMessages([
            {
                id: 'msg_demo_inline_tags',
                role: 'user',
                timestamp: '2025-07-09T10:30:00.000Z',
                blocks: [
                    {
                        type: 'text',
                        content: '[@file:src/services] 分析这个服务目录 [@file:src/services/payment/PaymentService.ts] 这是相关截图 [image1]'
                    }
                ]
            }
        ]);
        await webviewPage.locator('.messages-container').screenshot({ path: '../../docs/public/screenshots/spec-message-inline-tags.png' });

        // 14. Session Selector - 使用 SDK 的 SessionMetadata 类型
        const now = Date.now();
        const sessions: SessionMetadata[] = [
            {
                id: 'session-1',
                sessionType: 'main',
                workdir: '/home/dev/projects/nebula-platform',
                createdAt: new Date(now - 1000 * 60 * 60), // 1小时前创建
                lastActiveAt: new Date(now - 1000 * 60 * 30), // 30分钟前
                latestTotalTokens: 15420
            },
            {
                id: 'session-2',
                sessionType: 'main',
                workdir: '/home/dev/projects/nebula-platform',
                createdAt: new Date(now - 1000 * 60 * 60 * 3), // 3小时前创建
                lastActiveAt: new Date(now - 1000 * 60 * 60 * 2), // 2小时前
                latestTotalTokens: 32800
            },
            {
                id: 'session-3',
                sessionType: 'main',
                workdir: '/home/dev/projects/nebula-platform',
                createdAt: new Date(now - 1000 * 60 * 60 * 48), // 2天前创建
                lastActiveAt: new Date(now - 1000 * 60 * 60 * 24), // 1天前
                latestTotalTokens: 8600
            }
        ];
        
        await injector.simulateExtensionMessage('updateSessions', { sessions });
        await injector.simulateExtensionMessage('updateCurrentSession', {
            session: sessions[0]
        });
        
        // 打开历史对话弹窗以在截图中展示会话列表
        await webviewPage.getByTestId('history-btn').click();
        await webviewPage.waitForSelector('[data-testid="session-list-popup"]');

        await webviewPage.screenshot({ path: '../../docs/public/screenshots/spec-sessions.png' });

        // 关闭历史对话弹窗
        await webviewPage.keyboard.press('Escape');

        // 22. Vision
        const visionMessages = [
            {
                id: 'msg_demo_vision_user',
                role: 'user',
                blocks: [
                    { type: 'text', content: '请分析这个 UI 设计稿，帮我生成对应的 React 组件 [image1]' },
                    { type: 'image', imageUrls: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='] }
                ]
            },
            MockDataGenerator.createAssistantMessage('这是一个支付确认页面的设计稿。我可以识别出以下元素：\n\n1. **顶部导航栏** - 包含返回按钮和标题\n2. **金额展示区** - 大号字体显示支付金额\n3. **支付方式选择** - 支持银行卡和电子钱包\n4. **底部确认按钮** - 固定在底部\n\n我将基于这些元素生成对应的 React 组件...')
        ];
        await injector.updateMessages(visionMessages as unknown as Message[]);
        await webviewPage.locator('.messages-container').screenshot({ path: '../../docs/public/screenshots/spec-vision.png' });

        // 27. Reasoning
        await injector.simulateExtensionMessage('setInitialState', {
            messages: [
                {
                    id: 'msg_demo_reasoning',
                    role: 'assistant',
                    blocks: [
                        {
                            type: 'reasoning',
                            content: '用户需要对 PaymentService 进行重构以提高并发性能。我的分析步骤：\n\n1. **代码审查**：当前实现使用悲观锁，在高并发场景下会导致大量线程阻塞\n2. **性能分析**：数据库连接池在峰值时耗尽，平均响应时间 2.3s\n3. **重构方案**：\n   - 引入乐观锁替代悲观锁\n   - 添加 Redis 缓存层减少数据库访问\n   - 实现异步日志写入\n\n```typescript\n// 乐观锁实现示例\nconst withOptimisticLock = async <T>(\n  fn: (version: number) => Promise<T>\n): Promise<T> => {\n  const version = await getCurrentVersion();\n  return fn(version);\n};\n```'
                        },
                        {
                            type: 'text',
                            content: '基于以上分析，我建议分三个阶段进行重构。首先从乐观锁机制开始...'
                        }
                    ]
                }
            ]
        });
        await webviewPage.locator('.messages-container').screenshot({ path: '../../docs/public/screenshots/spec-reasoning.png' });
    });
});
