import { test } from '../utils/webviewTestHarness.js';
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
            configurationData: {
                apiKey: 'sk-xxxxxxxxxxxxxxxx',
                baseURL: 'https://api.openai.com/v1',
                model: 'gpt-4',
                fastModel: 'gpt-3.5-turbo'
            },
            permissionMode: 'default'
        });

        // 1. Welcome Message
        await ui.verifyMessageCount(1);
        await webviewPage.screenshot({ path: '../../docs/public/screenshots/spec-welcome.png' });

        // 1.3 Code Selection Tag
        await injector.simulateExtensionMessage('addSelectionToInput', {
            selection: {
                filePath: '/src/main.ts',
                fileName: 'main.ts',
                startLine: 10,
                endLine: 20,
                selectedText: 'console.log("Hello");',
                isEmpty: false
            }
        });
        await webviewPage.waitForSelector('.context-tag-container[data-is-selection="true"]');
        await webviewPage.locator('.input-container').screenshot({ path: '../../docs/public/screenshots/spec-selection-inline-tag.png' });
        
        // Clear input for next steps
        await webviewPage.focus('[data-testid="message-input"]');
        await webviewPage.keyboard.press('Control+A');
        await webviewPage.keyboard.press('Backspace');

        // 2. Basic Chat (Markdown & Code)
        const basicChat = [
            MockDataGenerator.createUserMessage('如何写一个 Hello World?'),
            MockDataGenerator.createAssistantMessage('在 TypeScript 中，你可以这样写：\n\n```typescript\nconsole.log("Hello, World!");\n```\n\n你可以使用 `tsc` 编译它。')
        ];
        await injector.updateMessages(basicChat);
        await injector.endStreaming();
        await ui.verifyMessageCount(3); // Welcome + user + assistant
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
                { id: 'explain', name: 'explain', description: '解释选中的代码' },
                { id: 'fix', name: 'fix', description: '修复代码中的问题' },
                { id: 'test', name: 'test', description: '为代码生成单元测试' }
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
                { path: 'src/main.ts', relativePath: 'src/main.ts', name: 'main.ts', icon: 'codicon-file-code' },
                { path: 'package.json', relativePath: 'package.json', name: 'package.json', icon: 'codicon-json' },
                { path: 'tsconfig.json', relativePath: 'tsconfig.json', name: 'tsconfig.json', icon: 'codicon-json' }
            ]
        });

        await webviewPage.waitForSelector('.suggestion-item', { state: 'visible', timeout: 5000 });
        await webviewPage.screenshot({ path: '../../docs/public/screenshots/spec-file-suggestions.png' });
        await webviewPage.keyboard.press('Escape');
        await webviewPage.keyboard.press('Control+A');
        await webviewPage.keyboard.press('Backspace');

        // 5. Mermaid Diagrams
        const mermaidChat = [
            MockDataGenerator.createAssistantMessage('这是一个系统架构图：\n\n```mermaid\ngraph TD\n    User --> WebApp\n    WebApp --> API\n    API --> DB[(Database)]\n```')
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
