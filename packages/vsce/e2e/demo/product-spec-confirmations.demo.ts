import { test, expect } from '../utils/webviewTestHarness.js';
import { MessageInjector } from '../utils/messageInjector.js';
import {
    EDIT_TOOL_NAME,
    BASH_TOOL_NAME,
    ASK_USER_QUESTION_TOOL_NAME,
    ENTER_PLAN_MODE_TOOL_NAME,
    EXIT_PLAN_MODE_TOOL_NAME,
    type Message
} from 'wave-agent-sdk';

test.describe('Product Specification Screenshots - Confirmations', () => {
    test('capture confirmation features', async ({ webviewPage }) => {
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

        // 10. Ask User Question - 显示确认对话框
        const askUserMessage: Message = {
            id: 'msg_demo_ask',
            role: 'assistant',
            timestamp: '2024-01-01T00:00:00.000Z',
            blocks: [
                {
                    type: 'tool',
                    name: ASK_USER_QUESTION_TOOL_NAME,
                    stage: 'running',
                    parameters: JSON.stringify({
                        questions: [
                            {
                                header: '选择框架',
                                question: '你想使用哪个前端框架？',
                                options: [
                                    { label: 'React', description: '流行的 UI 库' },
                                    { label: 'Vue', description: '渐进式框架' }
                                ]
                            }
                        ]
                    })
                }
            ]
        };
        await injector.updateMessages([askUserMessage]);
        
        // 显示确认对话框
        await injector.simulateExtensionMessage('showConfirmation', {
            confirmationId: 'ask-user-123',
            toolName: ASK_USER_QUESTION_TOOL_NAME,
            confirmationType: '问题待回答',
            toolInput: {
                questions: [
                    {
                        header: '选择框架',
                        question: '你想使用哪个前端框架？',
                        options: [
                            { label: 'React', description: '流行的 UI 库' },
                            { label: 'Vue', description: '渐进式框架' }
                        ]
                    }
                ]
            }
        });
        
        await webviewPage.waitForSelector('.confirmation-dialog');
        await webviewPage.screenshot({ path: '../../docs/public/screenshots/spec-ask-user.png' });
        
        // 关闭确认对话框以便继续其他截图
        await webviewPage.keyboard.press('Escape');
        await webviewPage.waitForSelector('.confirmation-dialog', { state: 'hidden' });

        // 11. Configuration Dialog (opened via /config or showConfiguration message)
        await injector.simulateExtensionMessage('showConfiguration', {
            configurationData: {
                apiKey: 'sk-xxxxxxxxxxxxxxxx',
                baseURL: 'https://api.openai.com/v1',
                model: 'gpt-4',
                fastModel: 'gpt-3.5-turbo'
            }
        });
        await webviewPage.waitForSelector('.configuration-dialog');
        await webviewPage.screenshot({ path: '../../docs/public/screenshots/spec-configuration.png' });
        await webviewPage.keyboard.press('Escape');
        await webviewPage.waitForSelector('.configuration-dialog', { state: 'hidden' });

        // 12. Permission Mode Select - Show all three modes
        const inputContainer = webviewPage.locator('.input-container');
        const permissionModeSelect = webviewPage.locator('.permission-mode-select');
        
        // Mode 1: Default (修改前询问)
        await injector.simulateExtensionMessage('updatePermissionMode', {
            mode: 'default'
        });
        await webviewPage.waitForSelector('.permission-mode-select');
        await expect(webviewPage.locator('.permission-mode-select')).toHaveValue('default');
        await permissionModeSelect.focus();
        await inputContainer.screenshot({ path: '../../docs/public/screenshots/spec-permission-mode-default.png' });

        // Mode 2: Accept Edits (自动接受修改)
        await injector.simulateExtensionMessage('updatePermissionMode', {
            mode: 'acceptEdits'
        });
        await expect(webviewPage.locator('.permission-mode-select')).toHaveValue('acceptEdits');
        await permissionModeSelect.focus();
        await inputContainer.screenshot({ path: '../../docs/public/screenshots/spec-permission-mode-accept.png' });

        // Mode 3: Plan Mode (计划模式)
        await injector.simulateExtensionMessage('updatePermissionMode', {
            mode: 'plan'
        });
        await expect(webviewPage.locator('.permission-mode-select')).toHaveValue('plan');
        await permissionModeSelect.focus();
        await inputContainer.screenshot({ path: '../../docs/public/screenshots/spec-permission-mode-plan.png' });

        // Reset to default for remaining screenshots
        await injector.simulateExtensionMessage('updatePermissionMode', {
            mode: 'default'
        });
        await expect(webviewPage.locator('.permission-mode-select')).toHaveValue('default');

        // 15. Plan 确认对话框 - 只显示确认对话框组件
        await injector.simulateExtensionMessage('showConfirmation', {
            confirmationId: 'plan-confirm-001',
            confirmationType: '计划执行确认',
            toolName: EXIT_PLAN_MODE_TOOL_NAME, // "ExitPlanMode"
            planContent: `## 项目重构计划

### 第一步：代码分析
- 分析现有代码结构
- 识别重构重点模块
- 评估依赖关系

### 第二步：重构实施
- 重构核心组件
- 优化数据流
- 更新测试用例

### 第三步：验证测试
- 运行完整测试套件
- 性能基准测试
- 用户验收测试`
        });
        const planConfirmDialog = webviewPage.locator('.confirmation-dialog');
        await planConfirmDialog.waitFor({ state: 'visible' });
        await planConfirmDialog.screenshot({ path: '../../docs/public/screenshots/spec-plan-confirm.png' });

        // 关闭当前确认对话框
        await webviewPage.click('.confirmation-close-btn');
        await planConfirmDialog.waitFor({ state: 'detached' });

        // 15.1 EnterPlanMode 确认对话框 - 简洁选项（仅批准/拒绝）
        await injector.simulateExtensionMessage('showConfirmation', {
            confirmationId: 'enter-plan-mode-001',
            confirmationType: '进入计划模式确认',
            toolName: ENTER_PLAN_MODE_TOOL_NAME, // "EnterPlanMode"
            toolInput: {},
            hidePersistentOption: true
        });
        const enterPlanDialog = webviewPage.locator('.confirmation-dialog');
        await enterPlanDialog.waitFor({ state: 'visible' });
        await enterPlanDialog.screenshot({ path: '../../docs/public/screenshots/spec-enter-plan-mode.png' });

        // 关闭当前确认对话框
        await webviewPage.click('.confirmation-close-btn');
        await enterPlanDialog.waitFor({ state: 'detached' });

        // 16. 代码修改确认对话框 - 只显示确认对话框组件
        await injector.simulateExtensionMessage('showConfirmation', {
            confirmationId: 'edit-confirm-001', 
            confirmationType: '代码修改确认',
            toolName: EDIT_TOOL_NAME, // "Edit"
            toolInput: {
                file_path: '/src/components/ChatInterface.tsx',
                old_string: 'const [messages, setMessages] = useState([]);',
                new_string: 'const [messages, setMessages] = useState<Message[]>([]);'
            }
        });
        const editConfirmDialog = webviewPage.locator('.confirmation-dialog');
        await editConfirmDialog.waitFor({ state: 'visible' });
        await editConfirmDialog.screenshot({ path: '../../docs/public/screenshots/spec-edit-confirm.png' });

        // 关闭当前确认对话框
        await webviewPage.click('.confirmation-close-btn');
        await editConfirmDialog.waitFor({ state: 'detached' });

        // 17. MCP 工具确认对话框
        await injector.simulateExtensionMessage('showConfirmation', {
            confirmationId: 'mcp-confirm-001',
            confirmationType: 'MCP 工具确认',
            toolName: 'mcp__wave_requirements__create_requirement',
            toolInput: {
                title: '前端改动',
                description: '在需求管理界面添加列表页',
                priority: 'high',
                tags: ['frontend', 'ui']
            }
        });
        const mcpConfirmDialog = webviewPage.locator('.confirmation-dialog');
        await mcpConfirmDialog.waitFor({ state: 'visible' });
        await mcpConfirmDialog.screenshot({ path: '../../docs/public/screenshots/spec-mcp-tool-confirm.png' });

        // 关闭当前确认对话框
        await webviewPage.click('.confirmation-close-btn');
        await mcpConfirmDialog.waitFor({ state: 'detached' });

        // 18. Bash运行确认对话框 - 只显示确认对话框组件
        await injector.simulateExtensionMessage('showConfirmation', {
            confirmationId: 'bash-confirm-001',
            confirmationType: 'Bash 命令执行确认', 
            toolName: BASH_TOOL_NAME, // "Bash"
            toolInput: {
                command: 'npm install --save-dev @types/react',
                description: '安装 React TypeScript 类型定义'
            }
        });
        const bashConfirmDialog = webviewPage.locator('.confirmation-dialog');
        await bashConfirmDialog.waitFor({ state: 'visible' });
        await bashConfirmDialog.screenshot({ path: '../../docs/public/screenshots/spec-bash-confirm.png' });
    });
});
