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
                        id: 'installed-user@wave-plugins-official',
                        name: 'Installed User Scope',
                        description: 'This plugin should show [user] badge',
                        marketplace: 'wave-plugins-official',
                        installed: true,
                        scope: 'user',
                        version: '1.0.0'
                    },
                    {
                        id: 'installed-project@wave-plugins-official',
                        name: 'Installed Project Scope',
                        description: 'This plugin should show [project] badge',
                        marketplace: 'wave-plugins-official',
                        installed: true,
                        scope: 'project',
                        version: '1.0.0'
                    },
                    {
                        id: 'installed-no-scope@wave-plugins-official',
                        name: 'Installed No Scope',
                        description: 'This plugin should NOT show any badge',
                        marketplace: 'wave-plugins-official',
                        installed: true,
                        scope: null,
                        version: '1.0.0'
                    },
                    {
                        id: 'not-installed@wave-plugins-official',
                        name: 'Not Installed',
                        description: 'This plugin should NOT show any badge',
                        marketplace: 'wave-plugins-official',
                        installed: false,
                        version: '1.0.0'
                    }
                ]
            }, '*');
        });

        // 3. Verify "Installed User Scope" plugin has the [user] badge
        const userItem = webviewPage.locator('.plugin-item').filter({ hasText: 'Installed User Scope' });
        await expect(userItem.locator('.plugin-scope')).toHaveText('[user]');

        // 4. Verify "Installed Project Scope" plugin has the [project] badge
        const projectItem = webviewPage.locator('.plugin-item').filter({ hasText: 'Installed Project Scope' });
        await expect(projectItem.locator('.plugin-scope')).toHaveText('[project]');

        // 5. Verify "Installed No Scope" plugin does NOT have the badge
        const noScopeItem = webviewPage.locator('.plugin-item').filter({ hasText: 'Installed No Scope' });
        await expect(noScopeItem.locator('.plugin-scope')).not.toBeVisible();

        // 6. Verify "Not Installed" plugin does NOT have the badge
        const notInstalledItem = webviewPage.locator('.plugin-item').filter({ hasText: 'Not Installed' });
        await expect(notInstalledItem.locator('.plugin-scope')).not.toBeVisible();

        // Take screenshot for verification
        await webviewPage.screenshot({ path: 'docs/public/screenshots/plugin-status-badge-verification.png' });
    });
});
