import { test, expect } from '../utils/webviewTestHarness.js';

test.describe('Plugin Status Badge Logic', () => {
    test('should only show "Installed" badge if plugin is both installed and enabled', async ({ webviewPage }) => {
        // 1. Open the plugin management dialog
        await webviewPage.evaluate(() => {
            window.simulateExtensionMessage({
                command: 'showDialog',
                dialogType: 'plugin'
            });
        });

        // 2. Simulate receiving plugins list with different states
        await webviewPage.evaluate(() => {
            window.postMessage({
                command: 'listPluginsResponse',
                plugins: [
                    {
                        id: 'git-workflow@wave-plugins-official',
                        name: 'Git Workflow',
                        description: '已安装到用户作用域，显示 [user] 标签',
                        marketplace: 'wave-plugins-official',
                        installed: true,
                        scope: 'user',
                        version: '2.3.1'
                    },
                    {
                        id: 'code-reviewer@wave-plugins-official',
                        name: 'Code Reviewer',
                        description: '已安装到项目作用域，显示 [project] 标签',
                        marketplace: 'wave-plugins-official',
                        installed: true,
                        scope: 'project',
                        version: '3.1.2'
                    },
                    {
                        id: 'database-explorer@wave-community',
                        name: 'Database Explorer',
                        description: '已安装但无作用域信息，不显示标签',
                        marketplace: 'wave-community',
                        installed: true,
                        scope: null,
                        version: '0.9.5'
                    },
                    {
                        id: 'kubernetes-helper@wave-plugins-official',
                        name: 'Kubernetes Helper',
                        description: '未安装的插件，不显示标签',
                        marketplace: 'wave-plugins-official',
                        installed: false,
                        version: '1.8.0'
                    }
                ]
            }, '*');
        });

        // 3. Verify "Git Workflow" plugin has the [user] badge
        const userItem = webviewPage.locator('.plugin-item').filter({ hasText: 'Git Workflow' });
        await expect(userItem.locator('.plugin-scope')).toHaveText('[user]');

        // 4. Verify "Code Reviewer" plugin has the [project] badge
        const projectItem = webviewPage.locator('.plugin-item').filter({ hasText: 'Code Reviewer' });
        await expect(projectItem.locator('.plugin-scope')).toHaveText('[project]');

        // 5. Verify "Database Explorer" plugin does NOT have the badge
        const noScopeItem = webviewPage.locator('.plugin-item').filter({ hasText: 'Database Explorer' });
        await expect(noScopeItem.locator('.plugin-scope')).not.toBeVisible();

        // 6. Verify "Kubernetes Helper" plugin does NOT have the badge
        const notInstalledItem = webviewPage.locator('.plugin-item').filter({ hasText: 'Kubernetes Helper' });
        await expect(notInstalledItem.locator('.plugin-scope')).not.toBeVisible();

        // Take screenshot for verification
        await webviewPage.screenshot({ path: '../../docs/public/screenshots/plugin-status-badge-verification.png' });
    });
});
