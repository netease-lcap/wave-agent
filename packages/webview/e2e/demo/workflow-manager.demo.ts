import { test, expect } from '../utils/webviewTestHarness.js';

test.describe('Workflow Manager Demo', () => {
    test('should show workflow run list and detail', async ({ webviewPage }) => {
        // Dialog min-width is 560px, wider than the default 400px demo viewport — widen so the full dialog is captured
        await webviewPage.setViewportSize({ width: 800, height: 700 });

        // 1. Open the dialog via showDialog
        await webviewPage.evaluate(() => {
            window.simulateExtensionMessage({
                command: 'showDialog',
                dialogType: 'workflows'
            });
        });

        // 2. Simulate extension pushing workflow runs
        await webviewPage.evaluate(() => {
            window.simulateExtensionMessage({
                command: 'updateWorkflowRuns',
                runs: [
                    {
                        runId: 'run-abc12345-def67890',
                        meta: {
                            name: 'audit-and-fix',
                            description: '审查并修复测试与类型错误',
                            phases: [
                                { title: 'Scan', detail: 'grep 测试日志查找重试' },
                                { title: 'Fix', detail: '每个 flaky 测试派一个代理' }
                            ]
                        },
                        status: 'running',
                        scriptPath: '/workflows/find-flaky-tests.mjs',
                        startTime: Date.now() - 120000,
                        phases: [
                            { title: 'Scan', agentCount: 4, tokens: 18500, elapsed: 45000, startTime: Date.now() - 120000 },
                            { title: 'Fix', agentCount: 3, tokens: 31200, elapsed: 75000, startTime: Date.now() - 75000 }
                        ],
                        totalAgents: 7,
                        totalTokens: 49700
                    },
                    {
                        runId: 'run-98765432-fedcba10',
                        meta: {
                            name: 'migrate-config',
                            description: '迁移配置到新格式'
                        },
                        status: 'completed',
                        scriptPath: '/workflows/migrate.mjs',
                        startTime: Date.now() - 600000,
                        endTime: Date.now() - 480000,
                        phases: [
                            { title: 'Discover', agentCount: 2, tokens: 8400, elapsed: 60000, startTime: Date.now() - 600000 },
                            { title: 'Transform', agentCount: 5, tokens: 22600, elapsed: 60000, startTime: Date.now() - 540000 }
                        ],
                        totalAgents: 7,
                        totalTokens: 31000
                    },
                    {
                        runId: 'run-failed00012345',
                        meta: {
                            name: 'deep-research',
                            description: '深度研究并生成报告'
                        },
                        status: 'failed',
                        scriptPath: '/workflows/research.mjs',
                        startTime: Date.now() - 900000,
                        endTime: Date.now() - 820000,
                        phases: [
                            { title: 'Search', agentCount: 6, tokens: 45300, elapsed: 80000, startTime: Date.now() - 900000 }
                        ],
                        totalAgents: 6,
                        totalTokens: 45300,
                        error: 'Agent #3 exceeded token budget and aborted'
                    }
                ]
            });
        });

        // Verify dialog is visible
        await expect(webviewPage.getByTestId('workflow-manager')).toBeVisible();

        // Screenshot the list view
        const dialog = webviewPage.getByTestId('workflow-manager');
        await dialog.screenshot({ path: '../../docs/public/screenshots/spec-workflow-list.png' });

        // 3. Click the running run to enter detail view
        await dialog.getByText('[run-abc1]').click();
        await expect(webviewPage.getByText('Phases:')).toBeVisible();

        // Screenshot the detail view
        await dialog.screenshot({ path: '../../docs/public/screenshots/spec-workflow-detail.png' });
    });
});
