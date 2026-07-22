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
            isAuthenticated: true,
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
        const diffUserMessage = MockDataGenerator.createUserMessage('把 PaymentService 里的 SQL 查询改成参数化写法，防止注入', 'msg_user_diff');
        await injector.updateMessages([diffUserMessage, diffMessage]);
        await webviewPage.waitForSelector('.tool-container');
        await webviewPage.screenshot({ path: '../../docs/public/screenshots/spec-diff-viewer.png' });

        // 7. Task List — rendered inline in the message stream at a TaskUpdate(completed) block
        const taskTasks = [
            { id: '1', subject: '分析现有支付服务架构', description: '审查 PaymentService 的分布式事务实现，识别竞态条件和性能瓶颈', status: 'completed', blocks: [], blockedBy: [], metadata: {} },
            { id: '2', subject: '实现乐观锁机制', description: '为支付服务引入版本号控制，防止并发更新冲突', status: 'in_progress', activeForm: '编写乐观锁中间件', blocks: ['3'], blockedBy: [], metadata: {} },
            { id: '3', subject: '编写集成测试', description: '覆盖并发支付场景，验证乐观锁和事务回滚的正确性', status: 'pending', blocks: [], blockedBy: ['2'], metadata: {} }
        ];
        const taskListMessage: Message = {
            id: 'msg_demo_tasklist',
            role: 'assistant',
            timestamp: '2025-07-09T10:30:00.000Z',
            blocks: [
                {
                    type: 'tool',
                    name: 'TaskUpdate',
                    stage: 'end',
                    parameters: JSON.stringify({ taskId: '1', status: 'completed' }),
                    result: 'Updated task #1'
                }
            ]
        };
        const taskUserMessage = MockDataGenerator.createUserMessage('把支付服务的并发问题彻底修一下', 'msg_user_tasklist');
        await injector.simulateExtensionMessage('updateTasks', { tasks: taskTasks, isTaskListCollapsed: false });
        await injector.updateMessages([taskUserMessage, taskListMessage]);
        await webviewPage.waitForSelector('.task-list-inline');
        await webviewPage.screenshot({ path: '../../docs/public/screenshots/spec-task-list.png' });

        // 7.1 Task List Collapsed
        await injector.simulateExtensionMessage('updateTasks', { tasks: taskTasks, isTaskListCollapsed: true });
        await webviewPage.waitForFunction(() => {
            const el = document.querySelector('.task-list-chevron');
            return el && el.classList.contains('codicon-chevron-right');
        });
        await webviewPage.screenshot({ path: '../../docs/public/screenshots/spec-task-list-collapsed.png' });

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
        const subagentUserMessage = MockDataGenerator.createUserMessage('帮我查一下项目里所有支付相关的 API 定义在哪', 'msg_user_subagent');
        await injector.updateMessages([subagentUserMessage, subagentMessage]);
        
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
        const bashUserMessage = MockDataGenerator.createUserMessage('跑一下测试套件，顺便生成覆盖率报告', 'msg_user_bash');
        await injector.updateMessages([bashUserMessage, bashMessage]);
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
        const explorationUserMessage = MockDataGenerator.createUserMessage('梳理一下 src/services 下的支付服务代码结构和接口定义', 'msg_user_exploration');
        await injector.updateMessages([explorationUserMessage, ...explorationMessages] as unknown as Message[]);
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
                        compactParams: 'src/middleware/optimisticLock.ts 18 lines, 512 chars',
                        parameters: JSON.stringify({
                            file_path: 'src/middleware/optimisticLock.ts',
                            content: `import { PaymentRepository } from '../repositories/PaymentRepository';

/**
 * 乐观锁中间件：基于版本号防止并发更新冲突。
 * 读取当前版本后执行业务逻辑，提交时校验版本一致性。
 */
export const withOptimisticLock = async <T>(
  repo: PaymentRepository,
  id: string,
  handler: (version: number) => Promise<T>
): Promise<T> => {
  const { version } = await repo.findById(id);
  const result = await handler(version);
  await repo.assertVersion(id, version);
  return result;
};`
                        }),
                        result: 'File created (18 lines, 512 characters)',
                        shortResult: 'File created (18 lines, 512 characters)'
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
        const fileOpUserMessage = MockDataGenerator.createUserMessage('新建一个乐观锁中间件，并给 processPayment 补上类型签名', 'msg_user_file_ops');
        await injector.updateMessages([fileOpUserMessage, ...fileOpMessages]);
        await webviewPage.waitForSelector('.write-preview-box');
        await webviewPage.locator('.messages-container').screenshot({ path: '../../docs/public/screenshots/spec-file-ops.png' });

        // 24. LSP
        await injector.simulateExtensionMessage('setInitialState', {
            messages: [
                MockDataGenerator.createUserMessage('分析 PaymentService 里 findById 的定义、引用和调用方', 'msg_user_lsp'),
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
                MockDataGenerator.createUserMessage('帮我调研一下主流支付网关的方案对比', 'msg_user_skill'),
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
                MockDataGenerator.createUserMessage('帮我在 Jira 里查一下进行中的支付相关需求', 'msg_user_mcp'),
                MockDataGenerator.createAssistantMessageWithTool(
                    '正在通过 MCP 服务器查询 Jira 中的支付相关需求...',
                    'mcp__jira__search_issues',
                    JSON.stringify({ jql: 'project = PAY AND status = "In Progress"', maxResults: 5 }),
                    'Found 5 issues: PAY-142 (Optimistic Lock), PAY-138 (Retry Logic), PAY-135 (Webhook), PAY-129 (Refund Flow), PAY-121 (Multi-currency)'
                )
            ]
        });
        await webviewPage.locator('.messages-container').screenshot({ path: '../../docs/public/screenshots/spec-mcp.png' });

        // 27. Sticky user message (吸顶) — pin the most recent user message scrolled above the viewport top
        await injector.simulateExtensionMessage('setInitialState', {
            messages: [
                MockDataGenerator.createUserMessage('帮我分析 PaymentService 的分布式事务实现，看看有没有竞态条件，并给出一个可落地的乐观锁改造方案，覆盖并发退款与重复回调的场景。', 'msg_user_sticky'),
                MockDataGenerator.createAssistantMessage(
                    '好的，我已通读 `PaymentService`。核心问题在于扣款与状态更新未在同一事务内串行化：\n\n1. 并发退款可能读到同一条 `payment` 行的旧版本，导致重复退款。\n2. 支付网关的重复回调没有幂等键，会触发二次状态跃迁。\n3. 事务隔离级别为 READ COMMITTED，缺少行级版本校验。\n\n建议引入版本号乐观锁：给 `payments` 表增加 `version` 列，更新时带 `WHERE id = ? AND version = ?`，冲突则重试。回调侧以 `gateway_event_id` 建唯一索引实现幂等。',
                    'msg_assistant_sticky_1'
                ),
                MockDataGenerator.createUserMessage('乐观锁重试次数怎么设置？会不会在高并发下一直失败？', 'msg_user_sticky_2'),
                MockDataGenerator.createAssistantMessage(
                    '建议采用有上限的指数退避重试：初始 20ms，最多重试 3 次，每次翻倍并叠加随机抖动，避免惊群。若 3 次仍冲突则返回 409 让上游决定是否重试。\n\n在实测的 200 QPS 退款压力下，单行冲突率约 4%，三次重试后失败率降到 0.01% 以下，尾延迟 P99 增加约 8ms，属于可接受范围。同时给 `payments(id)` 加覆盖索引减少回表。',
                    'msg_assistant_sticky_2'
                ),
                MockDataGenerator.createUserMessage('那重复回调的幂等键具体怎么设计？', 'msg_user_sticky_3'),
                MockDataGenerator.createAssistantMessage(
                    '以网关事件 ID 作为幂等键：新增 `payment_events(gateway_event_id UNIQUE, payment_id, status, created_at)`。回调进来先尝试插入该事件，唯一冲突即视为重复回调直接忽略；插入成功再执行状态跃迁。这样即使网关重发，也只会处理一次。整个流程放进同一事务，配合前面的版本号乐观锁，即可同时防住并发退款与重复回调两类竞态。',
                    'msg_assistant_sticky_3'
                )
            ],
            isAuthenticated: true,
            configurationData: {
                apiKey: 'sk-ant-api03-CXB9pH2k...mH8wQz',
                baseURL: 'https://api.anthropic.com/v1',
                model: 'claude-sonnet-4-20250514',
                fastModel: 'claude-haiku-4-20250514'
            },
            permissionMode: 'default'
        });
        await webviewPage.waitForSelector('.messages-container');
        // Scroll so an earlier user message is pushed above the viewport top, triggering the sticky header.
        await webviewPage.evaluate(() => {
            const el = document.querySelector('.messages-container') as HTMLElement;
            el.scrollTop = el.scrollHeight;
        });
        await webviewPage.waitForSelector('[data-testid="sticky-user-message"]');
        await webviewPage.locator('.messages-container').screenshot({ path: '../../docs/public/screenshots/spec-sticky-user-message.png' });
    });
});
