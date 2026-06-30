import { test } from '../utils/webviewTestHarness.js';
import { MessageInjector } from '../utils/messageInjector.js';
import { MockDataGenerator } from '../fixtures/mockData.js';
import fs from 'fs';
import path from 'path';
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
                apiKey: 'sk-xxxxxxxxxxxxxxxx',
                baseURL: 'https://api.openai.com/v1',
                model: 'gpt-4',
                fastModel: 'gpt-3.5-turbo'
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
        const logoPath = path.join(process.cwd(), 'LOGO.png');
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
        
        await webviewPage.locator('.input-container').screenshot({ path: 'docs/public/screenshots/spec-inline-mentions.png' });

        // 13d. Image Preview Modal
        const imageTag = webviewPage.locator('.context-tag.is-image');
        await imageTag.click();
        await webviewPage.waitForSelector('.image-preview-modal', { state: 'visible' });
        await webviewPage.screenshot({ path: 'docs/public/screenshots/spec-image-preview.png' });
        
        // Close modal
        await webviewPage.click('.image-preview-close');
        await webviewPage.waitForSelector('.image-preview-modal', { state: 'hidden' });

        // 13b. Message List with Inline Tags
        await injector.updateMessages([
            {
                id: 'msg_demo_inline_tags',
                role: 'user',
                timestamp: '2024-01-01T00:00:00.000Z',
                blocks: [
                    {
                        type: 'text',
                        content: '这是一个文件夹 [@file:src] 这是文本 [@file:src/main.ts] 这是图片 [@file:pasted-image.png]'
                    }
                ]
            }
        ]);
        await webviewPage.locator('.messages-container').screenshot({ path: 'docs/public/screenshots/spec-message-inline-tags.png' });

        // 14. Session Selector - 使用 SDK 的 SessionMetadata 类型
        const now = Date.now();
        const sessions: SessionMetadata[] = [
            {
                id: 'session-1',
                sessionType: 'main',
                workdir: '/project',
                createdAt: new Date(now - 1000 * 60 * 60), // 1小时前创建
                lastActiveAt: new Date(now - 1000 * 60 * 30), // 30分钟前
                latestTotalTokens: 1500
            },
            {
                id: 'session-2',
                sessionType: 'main',
                workdir: '/project',
                createdAt: new Date(now - 1000 * 60 * 60 * 3), // 3小时前创建
                lastActiveAt: new Date(now - 1000 * 60 * 60 * 2), // 2小时前
                latestTotalTokens: 2200
            },
            {
                id: 'session-3',
                sessionType: 'main',
                workdir: '/project',
                createdAt: new Date(now - 1000 * 60 * 60 * 48), // 2天前创建
                lastActiveAt: new Date(now - 1000 * 60 * 60 * 24), // 1天前
                latestTotalTokens: 800
            }
        ];
        
        await injector.simulateExtensionMessage('updateSessions', { sessions });
        await injector.simulateExtensionMessage('updateCurrentSession', {
            session: sessions[0]
        });
        
        // 等待会话选择器组件出现
        await webviewPage.waitForSelector('.session-selector');
        
        // 为了在截图中展示下拉框内容，我们将 select 的 size 属性设置为大于 1
        await webviewPage.evaluate(() => {
            const select = document.querySelector('.session-dropdown') as HTMLSelectElement;
            if (select) {
                select.size = 4; // 展示 4 个选项
                select.style.height = 'auto';
            }
        });
        
        await webviewPage.screenshot({ path: 'docs/public/screenshots/spec-sessions.png' });

        // 恢复 select 状态
        await webviewPage.evaluate(() => {
            const select = document.querySelector('.session-dropdown') as HTMLSelectElement;
            if (select) {
                select.size = 0;
            }
        });

        // 22. Vision
        const visionMessages = [
            {
                id: 'msg_demo_vision_user',
                role: 'user',
                blocks: [
                    { type: 'text', content: '这张图片里有什么？ [image1]' },
                    { type: 'image', imageUrls: ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='] }
                ]
            },
            MockDataGenerator.createAssistantMessage('这张图片显示了一个简单的 UI 布局，包含一个侧边栏和一个主内容区域。侧边栏使用了深色主题...')
        ];
        await injector.updateMessages(visionMessages as unknown as Message[]);
        await webviewPage.locator('.messages-container').screenshot({ path: 'docs/public/screenshots/spec-vision.png' });

        // 27. Reasoning
        await injector.simulateExtensionMessage('setInitialState', {
            messages: [
                {
                    id: 'msg_demo_reasoning',
                    role: 'assistant',
                    blocks: [
                        {
                            type: 'reasoning',
                            content: '我将按照以下步骤进行：\n\n1. **分析需求**：用户需要一个 React 教程\n2. **搜索资源**：查找相关文档和示例\n3. **生成内容**：整理并输出教程\n\n```typescript\n// 示例代码\nconst App = () => <div>Hello Wave</div>;\n```'
                        },
                        {
                            type: 'text',
                            content: '好的，这是一个关于 React 的基础教程...'
                        }
                    ]
                }
            ]
        });
        await webviewPage.locator('.messages-container').screenshot({ path: 'docs/public/screenshots/spec-reasoning.png' });
    });
});
