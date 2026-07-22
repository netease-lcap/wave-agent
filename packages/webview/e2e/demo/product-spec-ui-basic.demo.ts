import { test, expect } from '../utils/webviewTestHarness.js';
import { MessageInjector } from '../utils/messageInjector.js';
import { UIStateVerifier } from '../utils/uiStateVerifier.js';
import { MockDataGenerator } from '../fixtures/mockData.js';

test.describe('Product Specification Screenshots - UI Basic', () => {
    test('capture basic UI features', async ({ webviewPage }) => {
        const injector = new MessageInjector(webviewPage);
        const ui = new UIStateVerifier(webviewPage);

        // Set viewport size for better screenshots (simulating VS Code sidebar)
        await webviewPage.setViewportSize({ width: 400, height: 800 });

        // Provide initial state with valid configuration
        await injector.simulateExtensionMessage('setInitialState', {
            messages: [],
            isStreaming: false,
            sessions: [],
            isAuthenticated: true,
            configurationData: {
                apiKey: 'sk-ant-api03-CXB9pH2k...mH8wQz',
                baseURL: 'https://api.anthropic.com/v1',
                model: 'claude-sonnet-4-20250514',
                fastModel: 'claude-haiku-4-20250514'
            },
            permissionMode: 'default'
        });

        // 1. Welcome View (logged-in empty state)
        await expect(webviewPage.getByText('Hi~ 欢迎使用 Wave 代码智聊')).toBeVisible();
        await webviewPage.screenshot({ path: '../../docs/public/screenshots/spec-welcome.png' });

        // 1.1 Welcome View (unauthenticated state — with login button)
        await injector.simulateExtensionMessage('setInitialState', {
            messages: [],
            isStreaming: false,
            sessions: [],
            isAuthenticated: false,
            configurationData: {
                baseURL: 'https://api.anthropic.com/v1',
                model: 'claude-sonnet-4-20250514',
                fastModel: 'claude-haiku-4-20250514'
            },
            permissionMode: 'default'
        });
        await expect(webviewPage.getByText('登 录')).toBeVisible();

        // Verify layout geometry: logo svg present, login button full-width & horizontally centered
        const geometry = await webviewPage.evaluate(() => {
            const svg = document.querySelector('button svg, div svg');
            const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('登'));
            const container = document.querySelector('.chat-container') as HTMLElement | null;
            if (!svg || !btn || !container) return null;
            const sb = svg.getBoundingClientRect();
            const bb = btn.getBoundingClientRect();
            const cb = container.getBoundingClientRect();
            return {
                hasSvg: !!svg,
                btnWidth: Math.round(bb.width),
                containerWidth: Math.round(cb.width),
                btnLeftOffset: Math.round(bb.left - cb.left),
                btnRightOffset: Math.round(cb.right - bb.right),
                btnCenterDelta: Math.round((bb.left + bb.right) / 2 - (cb.left + cb.right) / 2)
            };
        });
        expect(geometry).not.toBeNull();
        expect(geometry!.hasSvg).toBe(true);
        // Button spans (nearly) the full container width
        expect(geometry!.btnWidth).toBeGreaterThan(geometry!.containerWidth - 40);
        // Button is horizontally centered within the container
        expect(Math.abs(geometry!.btnCenterDelta)).toBeLessThan(5);

        await webviewPage.screenshot({ path: '../../docs/public/screenshots/spec-welcome-login.png' });

        // Restore logged-in state for subsequent steps
        await injector.simulateExtensionMessage('setInitialState', {
            messages: [],
            isStreaming: false,
            sessions: [],
            isAuthenticated: true,
            configurationData: {
                apiKey: 'sk-ant-api03-CXB9pH2k...mH8wQz',
                baseURL: 'https://api.anthropic.com/v1',
                model: 'claude-sonnet-4-20250514',
                fastModel: 'claude-haiku-4-20250514'
            },
            permissionMode: 'default'
        });

        // 1.3 Code Selection Tag
        await injector.simulateExtensionMessage('addSelectionToInput', {
            selection: {
                filePath: '/src/services/payment/PaymentService.ts',
                fileName: 'PaymentService.ts',
                startLine: 45,
                endLine: 62,
                selectedText: 'async processPayment(tx: PaymentTx): Promise<Result> {',
                isEmpty: false
            }
        });
        await webviewPage.waitForSelector('.context-tag-container[data-is-selection="true"]');
        await webviewPage.locator('.input-container').screenshot({ path: '../../docs/public/screenshots/spec-selection-inline-tag.png' });
        
        // Clear input for next steps
        await webviewPage.focus('[data-testid="message-input"]');
        await webviewPage.keyboard.press('Control+A');
        await webviewPage.keyboard.press('Backspace');

        // 1.4 Input box states (设计稿 2237-5088): 空态 placeholder / 聚焦态红框 / 多行
        await webviewPage.locator('body').click({ position: { x: 5, y: 5 } });
        await webviewPage.locator('.input-container').screenshot({ path: '../../docs/public/screenshots/spec-input-empty.png' });

        await webviewPage.focus('[data-testid="message-input"]');
        await webviewPage.keyboard.type('帮我检查当前文件中的权限处理逻辑');
        await webviewPage.locator('.input-container').screenshot({ path: '../../docs/public/screenshots/spec-input-focus.png' });

        await webviewPage.keyboard.type('，找出可能遗漏的边界情况，并给出修改建议。同时保留现有接口行为，不要改动公共类型。请帮我检查当前文件中的权限处理逻辑，找出可能遗漏的边界情况，并给出修改建议。');
        await webviewPage.locator('.input-container').screenshot({ path: '../../docs/public/screenshots/spec-input-multiline.png' });

        // Clear input again for next steps
        await webviewPage.focus('[data-testid="message-input"]');
        await webviewPage.keyboard.press('Control+A');
        await webviewPage.keyboard.press('Backspace');

        // 2. Basic Chat (Markdown & Code)
        const basicChat = [
            MockDataGenerator.createUserMessage('如何在 TypeScript 中实现一个类型安全的 EventBus？'),
            MockDataGenerator.createAssistantMessage('下面是一个类型安全的 EventBus 实现，利用泛型与类型映射来保证事件名与回调参数的对应关系：\n\n```typescript\ntype EventHandler<T = unknown> = (payload: T) => void;\n\nclass EventBus<EventMap extends Record<string, unknown>> {\n  private handlers: { [K in keyof EventMap]?: EventHandler<EventMap[K]>[] } = {};\n\n  on<K extends keyof EventMap>(event: K, handler: EventHandler<EventMap[K]>): void {\n    (this.handlers[event] ||= []).push(handler);\n  }\n\n  off<K extends keyof EventMap>(event: K, handler: EventHandler<EventMap[K]>): void {\n    this.handlers[event] = (this.handlers[event] || []).filter(h => h !== handler);\n  }\n\n  emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): void {\n    (this.handlers[event] || []).forEach(h => h(payload));\n  }\n}\n```\n\n你可以通过 `EventBus.on(\'payment.completed\', handler)` 来订阅事件。')
        ];
        await injector.updateMessages(basicChat);
        await injector.endStreaming();
        await ui.verifyMessageCount(2); // user + assistant
        await webviewPage.screenshot({ path: '../../docs/public/screenshots/spec-basic-chat.png' });

        // 3. Slash Commands
        await injector.updateMessages([]);
        await webviewPage.focus('[data-testid="message-input"]');
        await webviewPage.keyboard.type('/');
        
        // Wait for the request to be sent to the extension
        await webviewPage.waitForFunction(() => {
            const messages = window.getTestMessages ? window.getTestMessages() : [];
            return messages.some((m) => m.command === 'requestSlashCommands');
        });

        await injector.simulateExtensionMessage('slashCommandsResponse', {
            commands: [
                // SDK 内置技能命令
                { id: 'code-review', name: 'code-review', description: '审查当前代码变更，检测正确性缺陷并提供优化建议' },
                { id: 'deep-research', name: 'deep-research', description: '深度研究：多源搜索、交叉验证、生成引用报告' },
                { id: 'init', name: 'init', description: '分析代码库并生成 AGENTS.md 文件，指导后续 Agent 工作' },
                { id: 'loop', name: 'loop', description: '按固定间隔循环执行指令（如 /loop 5m /code-review）' },
                { id: 'settings', name: 'settings', description: '管理 Wave 设置：hooks、环境变量、权限、MCP、内存等' },
                { id: 'simplify', name: 'simplify', description: '审查代码变更的复用性、简洁性和效率，并自动应用修复' },
                // UI 内置指令
                { id: 'config', name: 'config', description: '打开配置设置' },
                { id: 'model', name: 'model', description: '切换 AI 模型' },
                { id: 'plugin', name: 'plugin', description: '打开插件管理' },
                { id: 'mcp', name: 'mcp', description: '打开 MCP 服务器管理' },
                { id: 'status', name: 'status', description: '查看当前状态' },
                { id: 'clear', name: 'clear', description: '清除对话历史并重置会话' }
            ]
        });

        await webviewPage.waitForSelector('.slash-command-item', { state: 'visible', timeout: 5000 });
        await webviewPage.screenshot({ path: '../../docs/public/screenshots/spec-slash-commands.png' });
        await webviewPage.keyboard.press('Escape');

        // 4. File Suggestions (@)
        await webviewPage.focus('[data-testid="message-input"]');
        await webviewPage.keyboard.press('Control+A');
        await webviewPage.keyboard.press('Backspace');
        await webviewPage.keyboard.type('@');
        
        // Wait for the request to be sent and get the requestId
        const requestId = await webviewPage.evaluate(async () => {
            const poll = () => new Promise(resolve => {
                const check = () => {
                    const messages = window.getTestMessages ? window.getTestMessages() : [];
                    const reqs = messages.filter((m) => m.command === 'requestFileSuggestions');
                    if (reqs.length > 0) resolve(reqs[reqs.length - 1].requestId);
                    else setTimeout(check, 50);
                };
                check();
            });
            return await poll();
        });

        await injector.simulateExtensionMessage('fileSuggestionsResponse', {
            requestId: requestId,
            filterText: '',
            suggestions: [
                { path: 'src', relativePath: 'src', name: 'src', icon: 'codicon-folder' },
                { path: 'src/services/payment/PaymentService.ts', relativePath: 'src/services/payment/PaymentService.ts', name: 'PaymentService.ts', icon: 'codicon-file-code' },
                { path: 'src/utils/eventBus.ts', relativePath: 'src/utils/eventBus.ts', name: 'eventBus.ts', icon: 'codicon-file-code' },
                { path: 'package.json', relativePath: 'package.json', name: 'package.json', icon: 'codicon-json' }
            ]
        });

        await webviewPage.waitForSelector('.suggestion-item', { state: 'visible', timeout: 5000 });
        await webviewPage.screenshot({ path: '../../docs/public/screenshots/spec-file-suggestions.png' });
        await webviewPage.keyboard.press('Escape');
        await webviewPage.keyboard.press('Control+A');
        await webviewPage.keyboard.press('Backspace');

        // 5. Mermaid Diagrams
        const mermaidChat = [
            MockDataGenerator.createUserMessage('帮我画一张这套微服务的架构图', 'msg_user_mermaid'),
            MockDataGenerator.createAssistantMessage('这是一个微服务架构图：\n\n```mermaid\ngraph TD\n    Client[Client App] --> Gateway[API Gateway]\n    Gateway --> AuthSvc[Auth Service]\n    Gateway --> PaySvc[Payment Service]\n    Gateway --> OrderSvc[Order Service]\n    PaySvc --> DB[(Payment DB)]\n    OrderSvc --> DB2[(Order DB)]\n    PaySvc --> MQ[[Message Queue]]\n    MQ --> NotifySvc[Notification Service]\n```')
        ];
        await injector.updateMessages(mermaidChat);
        await injector.endStreaming();
        await webviewPage.waitForSelector('.mermaid-container svg');
        await webviewPage.screenshot({ path: '../../docs/public/screenshots/spec-mermaid.png' });

        // 23. Mermaid Fullscreen
        await webviewPage.click('.mermaid-container'); // Click to open fullscreen
        await webviewPage.waitForSelector('.mermaid-fullscreen-modal');
        await webviewPage.screenshot({ path: '../../docs/public/screenshots/spec-mermaid-fullscreen.png' });
        await webviewPage.keyboard.press('Escape');
    });
});
