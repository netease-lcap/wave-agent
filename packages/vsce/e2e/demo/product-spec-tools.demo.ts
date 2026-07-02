import { test } from '../utils/webviewTestHarness.js';
import { MessageInjector } from '../utils/messageInjector.js';
import { MockDataGenerator } from '../fixtures/mockData.js';
import { 
    EDIT_TOOL_NAME, 
    BASH_TOOL_NAME,
    GLOB_TOOL_NAME,
    GREP_TOOL_NAME,
    READ_TOOL_NAME,
    WRITE_TOOL_NAME,
    AGENT_TOOL_NAME,
    type Message
} from 'wave-agent-sdk';

test.describe('Product Specification Screenshots - Tools', () => {
    test('capture tool features', async ({ webviewPage }) => {
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

        // 6. Diff Viewer - 使用 MockDataGenerator 的 Edit 工具
        const diffMessage: Message = {
            id: 'msg_demo_diff',
            role: 'assistant',
            timestamp: '2024-01-01T00:00:00.000Z',
            blocks: [
                {
                    type: 'tool',
                    name: EDIT_TOOL_NAME,
                    stage: 'end',
                    compactParams: 'src/main.ts',
                    parameters: JSON.stringify({
                        file_path: 'src/main.ts',
                        old_string: 'console.log("Hello, World!");',
                        new_string: 'console.log("Hello, Wave!");'
                    }),
                    result: 'Text replaced successfully'
                }
            ]
        };
        await injector.updateMessages([diffMessage]);
        await webviewPage.waitForSelector('.tool-container');
        await webviewPage.screenshot({ path: '../../docs/public/screenshots/spec-diff-viewer.png' });

        // 7. Task List
        await injector.simulateExtensionMessage('updateTasks', {
            tasks: [
                { id: '1', subject: '搜索相关文件', description: '查找项目中与任务列表相关的组件和样式文件', status: 'completed', blocks: [], blockedBy: [], metadata: {} },
                { id: '2', subject: '实现任务列表组件', description: '编写 React 组件和 CSS 样式', status: 'in_progress', activeForm: '编写 CSS', blocks: ['3'], blockedBy: [], metadata: {} },
                { id: '3', subject: '运行测试', description: '确保新功能正常工作且不影响现有功能', status: 'pending', blocks: [], blockedBy: ['2'], metadata: {} }
            ],
            isTaskListCollapsed: false
        });
        await webviewPage.waitForSelector('.task-list-container');
        await webviewPage.screenshot({ path: '../../docs/public/screenshots/spec-task-list.png' });

        // 7.1 Task List Collapsed
        await injector.simulateExtensionMessage('updateTasks', {
            tasks: [
                { id: '1', subject: '搜索相关文件', status: 'completed', blocks: [], blockedBy: [], metadata: {} },
                { id: '2', subject: '实现任务列表组件', status: 'in_progress', blocks: ['3'], blockedBy: [], metadata: {} },
                { id: '3', subject: '运行测试', status: 'pending', blocks: [], blockedBy: ['2'], metadata: {} }
            ],
            isTaskListCollapsed: true
        });
        // Wait for the class to be applied
        await webviewPage.waitForFunction(() => {
            const el = document.querySelector('.task-list-container');
            return el && el.classList.contains('collapsed');
        });
        await webviewPage.screenshot({ path: '../../docs/public/screenshots/spec-task-list-collapsed.png' });
        
        // Restore expanded state for subsequent screenshots if needed
        await injector.simulateExtensionMessage('updateTasks', {
            tasks: [],
            isTaskListCollapsed: false
        });

        // 8. Subagent Display (Task Explore)
        const subagentMessage: Message = {
            id: 'msg_demo_subagent',
            role: 'assistant',
            timestamp: '2024-01-01T00:00:00.000Z',
            blocks: [
                {
                    type: 'tool',
                    name: AGENT_TOOL_NAME,
                    stage: 'running',
                    compactParams: 'Explore: 查找所有 API 定义',
                    parameters: JSON.stringify({ subagent_type: 'Explore', description: '查找所有 API 定义', prompt: '...' }),
                    shortResult: '...Read, Write (2 tools | 1,234 tokens)'
                }
            ]
        };
        await injector.updateMessages([subagentMessage]);
        
        await webviewPage.waitForSelector('.tool-container');
        await webviewPage.screenshot({ path: '../../docs/public/screenshots/spec-subagent.png' });

        // 9. Bash Tool - 使用 MockDataGenerator
        const bashMessage: Message = {
            id: 'msg_demo_bash',
            role: 'assistant',
            timestamp: '2024-01-01T00:00:00.000Z',
            blocks: [
                {
                    type: 'tool',
                    name: BASH_TOOL_NAME,
                    stage: 'end',
                    compactParams: '运行测试',
                    parameters: JSON.stringify({ command: 'npm test', description: '运行测试' }),
                    result: 'PASS  tests/index.test.ts\n  ✓ should work (5ms)\n\nTest Suites: 1 passed, 1 total\nTests:       1 passed, 1 total\nSnapshots:   0 total\nTime:        1.2s'
                }
            ]
        };
        await injector.updateMessages([bashMessage]);
        await webviewPage.waitForSelector('.bash-command-unified');
        await webviewPage.screenshot({ path: '../../docs/public/screenshots/spec-bash.png' });

        // 19. Exploration Tools
        const explorationMessages: Message[] = [
            {
                id: 'msg_demo_exploration',
                role: 'assistant',
                timestamp: '2024-01-01T00:00:00.000Z',
                blocks: [
                    {
                        type: 'tool',
                        name: AGENT_TOOL_NAME,
                        stage: 'end',
                        compactParams: 'Explore: 查找所有 API 定义',
                        parameters: JSON.stringify({ subagent_type: 'Explore', description: '查找所有 API 定义', prompt: '...' }),
                        result: '子代理已完成探索',
                        shortResult: '子代理已完成探索'
                    },
                    {
                        type: 'tool',
                        name: GLOB_TOOL_NAME,
                        stage: 'end',
                        compactParams: 'src/**/*.ts in src',
                        parameters: JSON.stringify({ pattern: 'src/**/*.ts', path: 'src' }),
                        result: 'src/main.ts\nsrc/app.tsx\nsrc/utils.ts',
                        shortResult: 'Found 3 files'
                    },
                    {
                        type: 'tool',
                        name: GREP_TOOL_NAME,
                        stage: 'end',
                        compactParams: 'interface.*API ts in src',
                        parameters: JSON.stringify({ pattern: 'interface.*API', type: 'ts', path: 'src' }),
                        result: 'src/types.ts:10:export interface UserAPI {\nsrc/types.ts:20:export interface AuthAPI {',
                        shortResult: 'Found 2 matching lines'
                    },
                    {
                        type: 'tool',
                        name: READ_TOOL_NAME,
                        stage: 'end',
                        compactParams: 'src/main.ts 1:2000',
                        parameters: JSON.stringify({ file_path: 'src/main.ts' }),
                        result: 'import express from "express";\n...',
                        shortResult: 'Read 150 lines'
                    }
                ]
            }
        ];
        await injector.updateMessages(explorationMessages as unknown as Message[]);
        await webviewPage.waitForSelector('.tool-container');
        await webviewPage.locator('.messages-container').screenshot({ path: '../../docs/public/screenshots/spec-exploration.png' });

        // 21. File Operation Tools
        const fileOpMessages: Message[] = [
            {
                id: 'msg_demo_file_ops',
                role: 'assistant',
                timestamp: '2024-01-01T00:00:00.000Z',
                blocks: [
                    {
                        type: 'tool',
                        name: WRITE_TOOL_NAME,
                        stage: 'end',
                        compactParams: 'src/new-file.ts 1 lines, 29 chars',
                        parameters: JSON.stringify({ file_path: 'src/new-file.ts', content: 'export const hello = "world";' }),
                        result: 'File created (1 lines, 29 characters)',
                        shortResult: 'File created'
                    },
                    {
                        type: 'tool',
                        name: EDIT_TOOL_NAME,
                        stage: 'end',
                        compactParams: 'src/app.tsx',
                        parameters: JSON.stringify({ file_path: 'src/app.tsx', old_string: 'A', new_string: 'B' }),
                        result: 'Text replaced successfully',
                        shortResult: 'Text replaced successfully'
                    }
                ]
            }
        ];
        await injector.updateMessages(fileOpMessages);
        await webviewPage.waitForSelector('.tool-container');
        await webviewPage.locator('.messages-container').screenshot({ path: '../../docs/public/screenshots/spec-file-ops.png' });

        // 24. LSP
        await injector.simulateExtensionMessage('setInitialState', {
            messages: [
                {
                    id: 'msg_demo_lsp',
                    role: 'assistant',
                    blocks: [
                        {
                            type: 'tool',
                            name: 'LSP',
                            stage: 'end',
                            compactParams: 'goToDefinition (src/main.ts:10:5)',
                            parameters: JSON.stringify({ operation: 'goToDefinition', filePath: 'src/main.ts', line: 10, character: 5 }),
                            result: 'Found definition at src/utils.ts:25:10'
                        },
                        {
                            type: 'tool',
                            name: 'LSP',
                            stage: 'end',
                            compactParams: 'findReferences (src/utils.ts:25:10)',
                            parameters: JSON.stringify({ operation: 'findReferences', filePath: 'src/utils.ts', line: 25, character: 10 }),
                            result: 'Found 3 references:\n- src/main.ts:10:5\n- src/app.ts:42:12\n- tests/utils.test.ts:15:8'
                        },
                        {
                            type: 'tool',
                            name: 'LSP',
                            stage: 'end',
                            compactParams: 'hover (src/main.ts:10:5)',
                            parameters: JSON.stringify({ operation: 'hover', filePath: 'src/main.ts', line: 10, character: 5 }),
                            result: 'interface User {\n  id: string;\n  name: string;\n}\n\nRepresents a user in the system.'
                        },
                        {
                            type: 'tool',
                            name: 'LSP',
                            stage: 'end',
                            compactParams: 'incomingCalls (src/utils.ts:25:10)',
                            parameters: JSON.stringify({ operation: 'incomingCalls', filePath: 'src/utils.ts', line: 25, character: 10 }),
                            result: 'Callers of getUser:\n- AuthService.login (src/auth.ts:50)\n- AdminPanel.render (src/admin.tsx:120)'
                        }
                    ]
                }
            ]
        });
        await webviewPage.locator('.messages-container').screenshot({ path: '../../docs/public/screenshots/spec-lsp.png' });

        // 25. Skill
        await injector.simulateExtensionMessage('setInitialState', {
            messages: [
                {
                    id: 'msg_demo_skill',
                    role: 'assistant',
                    blocks: [
                        {
                            type: 'tool',
                            name: 'Skill',
                            stage: 'end',
                            compactParams: 'docx',
                            parameters: JSON.stringify({ skill_name: 'docx' }),
                            result: 'Document created successfully at ./report.docx',
                            shortResult: 'Invoked skill: docx'
                        }
                    ]
                }
            ]
        });
        await webviewPage.locator('.messages-container').screenshot({ path: '../../docs/public/screenshots/spec-skill.png' });

        // 26. MCP
        await injector.simulateExtensionMessage('setInitialState', {
            messages: [
                MockDataGenerator.createAssistantMessageWithTool(
                    '正在通过 MCP 查询外部数据...',
                    'mcp_search_tool',
                    JSON.stringify({ query: 'latest news' }),
                    'Found 3 results from external source.'
                )
            ]
        });
        await webviewPage.locator('.messages-container').screenshot({ path: '../../docs/public/screenshots/spec-mcp.png' });
    });
});
