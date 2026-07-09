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
                apiKey: 'sk-ant-api03-CXB9pH2k...mH8wQz',
                baseURL: 'https://api.anthropic.com/v1',
                model: 'claude-sonnet-4-20250514',
                fastModel: 'claude-haiku-4-20250514'
            },
            permissionMode: 'default'
        });

        // 6. Diff Viewer - 使用 MockDataGenerator 的 Edit 工具
        const diffMessage: Message = {
            id: 'msg_demo_diff',
            role: 'assistant',
            timestamp: '2025-07-09T10:30:00.000Z',
            blocks: [
                {
                    type: 'tool',
                    name: EDIT_TOOL_NAME,
                    stage: 'end',
                    compactParams: 'src/services/payment/PaymentService.ts',
                    parameters: JSON.stringify({
                        file_path: 'src/services/payment/PaymentService.ts',
                        old_string: 'const result = await this.db.query("SELECT * FROM payments WHERE id = ?", tx.id);',
                        new_string: 'const result = await this.db.query("SELECT * FROM payments WHERE id = $1", [tx.id]);'
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
                { id: '1', subject: '分析现有支付服务架构', description: '审查 PaymentService 的分布式事务实现，识别竞态条件和性能瓶颈', status: 'completed', blocks: [], blockedBy: [], metadata: {} },
                { id: '2', subject: '实现乐观锁机制', description: '为支付服务引入版本号控制，防止并发更新冲突', status: 'in_progress', activeForm: '编写乐观锁中间件', blocks: ['3'], blockedBy: [], metadata: {} },
                { id: '3', subject: '编写集成测试', description: '覆盖并发支付场景，验证乐观锁和事务回滚的正确性', status: 'pending', blocks: [], blockedBy: ['2'], metadata: {} }
            ],
            isTaskListCollapsed: false
        });
        await webviewPage.waitForSelector('.task-list-container');
        await webviewPage.screenshot({ path: '../../docs/public/screenshots/spec-task-list.png' });

        // 7.1 Task List Collapsed
        await injector.simulateExtensionMessage('updateTasks', {
            tasks: [
                { id: '1', subject: '分析现有支付服务架构', status: 'completed', blocks: [], blockedBy: [], metadata: {} },
                { id: '2', subject: '实现乐观锁机制', status: 'in_progress', blocks: ['3'], blockedBy: [], metadata: {} },
                { id: '3', subject: '编写集成测试', status: 'pending', blocks: [], blockedBy: ['2'], metadata: {} }
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
            timestamp: '2025-07-09T10:30:00.000Z',
            blocks: [
                {
                    type: 'tool',
                    name: AGENT_TOOL_NAME,
                    stage: 'running',
                    compactParams: 'Explore: 查找所有支付相关 API 定义',
                    parameters: JSON.stringify({ subagent_type: 'Explore', description: '查找所有支付相关 API 定义', prompt: '...' }),
                    shortResult: '...Read, Grep (2 tools | 3,421 tokens)'
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
            timestamp: '2025-07-09T10:30:00.000Z',
            blocks: [
                {
                    type: 'tool',
                    name: BASH_TOOL_NAME,
                    stage: 'end',
                    compactParams: 'pnpm test -- --coverage',
                    parameters: JSON.stringify({ command: 'pnpm test -- --coverage', description: '运行测试套件并生成覆盖率报告' }),
                    result: ' RUN  v3.1.0 /home/dev/projects/nebula-platform\n\n ✓ src/services/payment/PaymentService.test.ts (8 tests) 142ms\n ✓ src/utils/eventBus.test.ts (5 tests) 67ms\n ✓ src/middleware/optimisticLock.test.ts (3 tests) 89ms\n\n Test Files  3 passed (3)\n      Tests  16 passed (16)\n   Coverage  94.2% Statements\n              87.5% Branches\n              92.1% Functions\n Duration   2.4s'
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
                timestamp: '2025-07-09T10:30:00.000Z',
                blocks: [
                    {
                        type: 'tool',
                        name: AGENT_TOOL_NAME,
                        stage: 'end',
                        compactParams: 'Explore: 查找所有支付相关 API 定义',
                        parameters: JSON.stringify({ subagent_type: 'Explore', description: '查找所有支付相关 API 定义', prompt: '...' }),
                        result: '子代理已扫描 42 个文件，识别出 12 个支付相关接口定义',
                        shortResult: '子代理已扫描 42 个文件，识别出 12 个支付相关接口定义'
                    },
                    {
                        type: 'tool',
                        name: GLOB_TOOL_NAME,
                        stage: 'end',
                        compactParams: 'src/services/**/*.ts in src',
                        parameters: JSON.stringify({ pattern: 'src/services/**/*.ts', path: 'src' }),
                        result: 'src/services/payment/PaymentService.ts\nsrc/services/payment/TransactionLogger.ts\nsrc/services/payment/RefundHandler.ts',
                        shortResult: 'Found 3 files'
                    },
                    {
                        type: 'tool',
                        name: GREP_TOOL_NAME,
                        stage: 'end',
                        compactParams: 'interface.*Payment ts in src',
                        parameters: JSON.stringify({ pattern: 'interface.*Payment', type: 'ts', path: 'src' }),
                        result: 'src/types/payment.ts:15:export interface PaymentRequest {\nsrc/types/payment.ts:32:export interface PaymentResult {\nsrc/services/payment/PaymentService.ts:28:export interface PaymentService {',
                        shortResult: 'Found 3 matching lines'
                    },
                    {
                        type: 'tool',
                        name: READ_TOOL_NAME,
                        stage: 'end',
                        compactParams: 'src/services/payment/PaymentService.ts 1:2000',
                        parameters: JSON.stringify({ file_path: 'src/services/payment/PaymentService.ts' }),
                        result: 'import { Injectable } from "@nestjs/common";\nimport { PaymentRepository } from "./PaymentRepository";\n\n@Injectable()\nexport class PaymentService {\n  constructor(private readonly repo: PaymentRepository) {}',
                        shortResult: 'Read 156 lines'
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
                timestamp: '2025-07-09T10:30:00.000Z',
                blocks: [
                    {
                        type: 'tool',
                        name: WRITE_TOOL_NAME,
                        stage: 'end',
                        compactParams: 'src/middleware/optimisticLock.ts 1 lines, 89 chars',
                        parameters: JSON.stringify({ file_path: 'src/middleware/optimisticLock.ts', content: 'export const withOptimisticLock = <T>(handler: (version: number) => Promise<T>) => { ... };' }),
                        result: 'File created (1 lines, 89 characters)',
                        shortResult: 'File created'
                    },
                    {
                        type: 'tool',
                        name: EDIT_TOOL_NAME,
                        stage: 'end',
                        compactParams: 'src/services/payment/PaymentService.ts',
                        parameters: JSON.stringify({ file_path: 'src/services/payment/PaymentService.ts', old_string: 'async processPayment(tx) {', new_string: 'async processPayment(tx: PaymentTx): Promise<Result> {' }),
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
                            compactParams: 'goToDefinition (src/services/payment/PaymentService.ts:28:15)',
                            parameters: JSON.stringify({ operation: 'goToDefinition', filePath: 'src/services/payment/PaymentService.ts', line: 28, character: 15 }),
                            result: 'Found definition at src/repositories/PaymentRepository.ts:12:14'
                        },
                        {
                            type: 'tool',
                            name: 'LSP',
                            stage: 'end',
                            compactParams: 'findReferences (src/repositories/PaymentRepository.ts:12:14)',
                            parameters: JSON.stringify({ operation: 'findReferences', filePath: 'src/repositories/PaymentRepository.ts', line: 12, character: 14 }),
                            result: 'Found 8 references:\n- src/services/payment/PaymentService.ts:28:5\n- src/services/payment/RefundHandler.ts:45:12\n- src/services/payment/TransactionLogger.ts:67:8\n- src/controllers/PaymentController.ts:33:22\n- src/middleware/paymentGuard.ts:18:3\n- tests/payment/PaymentService.test.ts:92:14\n- tests/payment/integration.test.ts:28:9\n- e2e/payment.spec.ts:15:7'
                        },
                        {
                            type: 'tool',
                            name: 'LSP',
                            stage: 'end',
                            compactParams: 'hover (src/services/payment/PaymentService.ts:28:15)',
                            parameters: JSON.stringify({ operation: 'hover', filePath: 'src/services/payment/PaymentService.ts', line: 28, character: 15 }),
                            result: 'class PaymentService\n\nHandles payment processing with distributed transaction support. Implements optimistic locking and automatic retry logic for concurrent operations.\n\n@Injectable()'
                        },
                        {
                            type: 'tool',
                            name: 'LSP',
                            stage: 'end',
                            compactParams: 'incomingCalls (src/repositories/PaymentRepository.ts:12:14)',
                            parameters: JSON.stringify({ operation: 'incomingCalls', filePath: 'src/repositories/PaymentRepository.ts', line: 12, character: 14 }),
                            result: 'Callers of findById:\n- PaymentService.processPayment (src/services/payment/PaymentService.ts:45)\n- RefundHandler.processRefund (src/services/payment/RefundHandler.ts:78)\n- TransactionLogger.audit (src/services/payment/TransactionLogger.ts:112)\n- PaymentController.getStatus (src/controllers/PaymentController.ts:55)'
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
                            compactParams: 'deep-research',
                            parameters: JSON.stringify({ skill_name: 'deep-research' }),
                            result: 'Research complete: analyzed 15 sources, generated comprehensive report at ./reports/payment-gateway-comparison.md',
                            shortResult: 'Invoked skill: deep-research'
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
                    '正在通过 MCP 服务器查询 Jira 中的支付相关需求...',
                    'mcp__jira__search_issues',
                    JSON.stringify({ jql: 'project = PAY AND status = "In Progress"', maxResults: 5 }),
                    'Found 5 issues: PAY-142 (Optimistic Lock), PAY-138 (Retry Logic), PAY-135 (Webhook), PAY-129 (Refund Flow), PAY-121 (Multi-currency)'
                )
            ]
        });
        await webviewPage.locator('.messages-container').screenshot({ path: '../../docs/public/screenshots/spec-mcp.png' });
    });
});
