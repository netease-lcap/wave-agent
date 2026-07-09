import { test, expect } from '../utils/webviewTestHarness.js';

test.describe('Plugin Management Dialog Demo', () => {
    test('should show plugin tabs and content in plugin dialog', async ({ webviewPage }) => {
        // 1. Open the plugin management dialog via showDialog
        await webviewPage.evaluate(() => {
            window.simulateExtensionMessage({
                command: 'showDialog',
                dialogType: 'plugin'
            });
        });

        // Verify dialog is visible
        await expect(webviewPage.getByText('插件管理', { exact: true })).toBeVisible();

        // Verify plugin sub-tabs are visible
        await expect(webviewPage.getByText('探索新插件', { exact: true })).toBeVisible();
        await expect(webviewPage.getByText('已安装插件', { exact: true })).toBeVisible();
        await expect(webviewPage.getByText('插件市场', { exact: true })).toBeVisible();

        // 2. Simulate receiving plugins list
        await webviewPage.evaluate(() => {
            window.postMessage({
                command: 'listPluginsResponse',
                plugins: [
                    {
                        id: 'git-workflow@wave-plugins-official',
                        name: 'git-workflow',
                        description: '集成 Git 工作流，支持智能提交信息生成、PR 审查和冲突解决',
                        marketplace: 'wave-plugins-official',
                        installed: false,
                        version: '2.3.1'
                    },
                    {
                        id: 'kubernetes-helper@wave-plugins-official',
                        name: 'kubernetes-helper',
                        description: '简化 K8s 集群管理，提供 Pod 诊断、日志查询和资源监控',
                        marketplace: 'wave-plugins-official',
                        installed: false,
                        version: '1.8.0'
                    },
                    {
                        id: 'database-explorer@wave-community',
                        name: 'database-explorer',
                        description: '连接多种数据库（PostgreSQL、MySQL、MongoDB），支持智能查询和 schema 可视化',
                        marketplace: 'wave-community',
                        installed: false,
                        version: '0.9.5'
                    },
                    {
                        id: 'code-reviewer@wave-plugins-official',
                        name: 'code-reviewer',
                        description: 'AI 驱动的代码审查工具，自动检测安全漏洞、性能问题和最佳实践违规',
                        marketplace: 'wave-plugins-official',
                        installed: false,
                        version: '3.1.2'
                    },
                    {
                        id: 'api-docs-generator@wave-community',
                        name: 'api-docs-generator',
                        description: '从代码自动生成 OpenAPI 文档，支持实时预览和交互式测试',
                        marketplace: 'wave-community',
                        installed: false,
                        version: '1.4.0'
                    }
                ]
            }, '*');
        });

        // Take screenshot of "Explore" tab
        await webviewPage.screenshot({ path: '../../docs/public/screenshots/plugins-explore-tab.png' });

        // 3. Switch to "已安装插件" tab
        await webviewPage.getByText('已安装插件', { exact: true }).click();

        // Simulate receiving installed plugins list
        await webviewPage.evaluate(() => {
            window.postMessage({
                command: 'listPluginsResponse',
                plugins: [
                    {
                        id: 'code-reviewer@wave-plugins-official',
                        name: 'code-reviewer',
                        description: 'AI 驱动的代码审查工具，自动检测安全漏洞、性能问题和最佳实践违规',
                        marketplace: 'wave-plugins-official',
                        installed: true,
                        scope: 'user',
                        version: '3.1.2'
                    }
                ]
            }, '*');
        });

        await expect(webviewPage.locator('.plugin-name').filter({ hasText: 'code-reviewer' })).toBeVisible();
        await webviewPage.screenshot({ path: '../../docs/public/screenshots/plugins-installed-tab.png' });

        // 4. Switch to "插件市场" tab
        await webviewPage.getByText('插件市场', { exact: true }).click();

        // Simulate receiving marketplaces list
        await webviewPage.evaluate(() => {
            window.postMessage({
                command: 'listMarketplacesResponse',
                marketplaces: [
                    { name: 'wave-plugins-official', url: 'https://github.com/wave-ai/wave-plugins-official' },
                    { name: 'wave-community', url: 'https://github.com/wave-community/plugins' },
                    { name: 'nebula-internal', url: 'https://git.nebula-tech.com/plugins' }
                ]
            }, '*');
        });

        await expect(webviewPage.getByText('wave-plugins-official', { exact: true })).toBeVisible();
        await webviewPage.screenshot({ path: '../../docs/public/screenshots/plugins-marketplaces-tab.png' });
    });
});
