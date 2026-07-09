import { test, expect } from '../utils/webviewTestHarness.js';

test.describe('Plugin Search UI Demo', () => {
    test('should show search input and filter plugins by keyword', async ({ webviewPage }) => {
        // 1. Open the plugin management dialog
        await webviewPage.evaluate(() => {
            window.simulateExtensionMessage({
                command: 'showDialog',
                dialogType: 'plugin'
            });
        });

        await expect(webviewPage.getByText('插件管理', { exact: true })).toBeVisible();

        // 2. Simulate receiving plugins list
        await webviewPage.evaluate(() => {
            window.postMessage({
                command: 'listPluginsResponse',
                plugins: [
                    {
                        id: 'git-workflow@wave-plugins-official',
                        name: 'git-workflow',
                        description: '集成 Git 工作流，支持智能提交信息和 PR 审查',
                        marketplace: 'wave-plugins-official',
                        installed: false,
                        version: '2.3.1'
                    },
                    {
                        id: 'kubernetes-helper@wave-plugins-official',
                        name: 'kubernetes-helper',
                        description: 'K8s 集群管理和 Pod 诊断工具',
                        marketplace: 'wave-plugins-official',
                        installed: false,
                        version: '1.8.0'
                    },
                    {
                        id: 'database-explorer@wave-community',
                        name: 'database-explorer',
                        description: '多数据库连接和智能查询工具',
                        marketplace: 'wave-community',
                        installed: false,
                        version: '0.9.5'
                    },
                    {
                        id: 'api-docs-generator@wave-community',
                        name: 'api-docs-generator',
                        description: '自动生成 OpenAPI 文档',
                        marketplace: 'wave-community',
                        installed: false,
                        version: '1.4.0'
                    }
                ]
            }, '*');
        });

        // 3. Verify search input is visible
        const searchInput = webviewPage.locator('.plugin-search input');
        await expect(searchInput).toBeVisible();
        await expect(searchInput).toHaveAttribute('placeholder', '搜索插件...');

        // Screenshot of search input with all plugins
        await webviewPage.screenshot({ path: '../../docs/public/screenshots/plugin-search-input.png' });

        // 4. Type "git" to filter
        await searchInput.fill('git');

        // Verify only git-workflow is shown
        await expect(webviewPage.locator('.plugin-name', { hasText: 'git-workflow' })).toBeVisible();
        await expect(webviewPage.locator('.plugin-name', { hasText: 'kubernetes-helper' })).not.toBeVisible();
        await expect(webviewPage.locator('.plugin-name', { hasText: 'database-explorer' })).not.toBeVisible();
        await expect(webviewPage.locator('.plugin-name', { hasText: 'api-docs-generator' })).not.toBeVisible();

        await webviewPage.screenshot({ path: '../../docs/public/screenshots/plugin-search-filtered.png' });

        // 5. Type a non-matching query
        await searchInput.fill('zzz-nonexistent');
        await expect(webviewPage.getByText('没有找到匹配的插件')).toBeVisible();

        await webviewPage.screenshot({ path: '../../docs/public/screenshots/plugin-search-no-results.png' });

        // 6. Clear the search
        await searchInput.fill('');
        await expect(webviewPage.locator('.plugin-name', { hasText: 'git-workflow' })).toBeVisible();
        await expect(webviewPage.locator('.plugin-name', { hasText: 'kubernetes-helper' })).toBeVisible();
    });
});
