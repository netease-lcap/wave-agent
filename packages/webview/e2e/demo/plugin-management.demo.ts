import { test, expect } from '../utils/webviewTestHarness.js';

test.describe('Plugin Management Screenshots', () => {
    test('capture plugin management features', async ({ webviewPage }) => {
        // Set viewport size for better screenshots
        await webviewPage.setViewportSize({ width: 500, height: 700 });

        // 1. Open plugin management dialog
        await webviewPage.evaluate(() => {
            window.simulateExtensionMessage({
                command: 'showDialog',
                dialogType: 'plugin'
            });
        });

        await expect(webviewPage.getByText('插件管理', { exact: true })).toBeVisible();
        await expect(webviewPage.getByText('探索新插件', { exact: true })).toBeVisible();

        // 2. Explore plugins tab - 展示可安装的插件列表和作用域选择
        await webviewPage.evaluate(() => {
            window.postMessage({
                command: 'listPluginsResponse',
                plugins: [
                    {
                        id: 'git-workflow@wave-plugins-official',
                        name: 'Git Workflow',
                        description: '集成 Git 工作流，支持智能提交信息生成、PR 审查和冲突解决',
                        marketplace: 'wave-plugins-official',
                        installed: false,
                        version: '2.3.1'
                    },
                    {
                        id: 'kubernetes-helper@wave-plugins-official',
                        name: 'Kubernetes Helper',
                        description: '简化 K8s 集群管理，提供 Pod 诊断、日志查询和资源监控',
                        marketplace: 'wave-plugins-official',
                        installed: false,
                        version: '1.8.0'
                    },
                    {
                        id: 'database-explorer@wave-community',
                        name: 'Database Explorer',
                        description: '连接多种数据库（PostgreSQL、MySQL、MongoDB），支持智能查询和 schema 可视化',
                        marketplace: 'wave-community',
                        installed: false,
                        version: '0.9.5'
                    },
                    {
                        id: 'code-reviewer@wave-plugins-official',
                        name: 'Code Reviewer',
                        description: 'AI 驱动的代码审查工具，自动检测安全漏洞、性能问题和最佳实践违规',
                        marketplace: 'wave-plugins-official',
                        installed: true,
                        enabled: true,
                        version: '3.1.2',
                        scope: 'user'
                    },
                    {
                        id: 'api-docs-generator@wave-community',
                        name: 'API Docs Generator',
                        description: '从代码自动生成 OpenAPI 文档，支持实时预览和交互式测试',
                        marketplace: 'wave-community',
                        installed: true,
                        enabled: false,
                        version: '1.4.0',
                        scope: 'project'
                    }
                ]
            }, '*');
        });

        await webviewPage.waitForSelector('.plugin-item');

        // 确保可以看到可安装的插件列表
        await expect(webviewPage.getByText('Git Workflow')).toBeVisible();
        await expect(webviewPage.getByText('Kubernetes Helper')).toBeVisible();

        // 截图：探索新插件列表页
        await webviewPage.screenshot({ path: '../../docs/public/screenshots/spec-plugin-explore-list.png' });

        // 点击一个插件查看详情
        await webviewPage.getByText('Git Workflow').click();

        // 等待详情页显示
        await expect(webviewPage.getByText('返回列表')).toBeVisible();
        await expect(webviewPage.getByText('选择安装作用域')).toBeVisible();
        await expect(webviewPage.getByText('为你安装 (user)')).toBeVisible();
        await expect(webviewPage.getByText('为此仓库的所有协作者安装 (project)')).toBeVisible();
        await expect(webviewPage.getByText('仅为你在此仓库中安装 (local)')).toBeVisible();

        // 截图：插件详情页，显示安装作用域选择
        await webviewPage.screenshot({ path: '../../docs/public/screenshots/spec-plugin-explore.png' });

        // 返回列表
        await webviewPage.getByText('返回列表').click();
        await expect(webviewPage.getByText('Git Workflow')).toBeVisible();

        // 3. Installed plugins tab - 展示已激活插件及更新和卸载按钮
        await webviewPage.getByText('已安装插件', { exact: true }).click();

        // 等待已安装插件渲染
        await webviewPage.waitForSelector('.plugin-item:has-text("Code Reviewer")');

        // 确认更新和卸载按钮存在
        await expect(webviewPage.locator('.update-btn').first()).toBeVisible();
        await expect(webviewPage.locator('.uninstall-btn').first()).toBeVisible();

        // 截图：已激活插件标签页，显示更新和卸载按钮
        await webviewPage.screenshot({ path: '../../docs/public/screenshots/spec-plugin-installed.png' });

        // 4. Marketplaces tab - 展示插件市场管理
        await webviewPage.getByText('插件市场', { exact: true }).click();

        // Simulate marketplace list
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

        await webviewPage.waitForSelector('.marketplace-item');

        // 确保输入框和按钮可见
        await expect(webviewPage.locator('input[placeholder*="市场 URL"]')).toBeVisible();
        await expect(webviewPage.getByText('添加', { exact: true })).toBeVisible();

        // 截图：插件市场标签页，显示市场列表和管理功能
        await webviewPage.screenshot({ path: '../../docs/public/screenshots/spec-plugin-marketplaces.png' });

        // Close the dialog
        await webviewPage.keyboard.press('Escape');
    });
});
