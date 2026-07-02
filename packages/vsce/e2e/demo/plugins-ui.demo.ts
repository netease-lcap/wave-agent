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
                        id: 'commit-commands@wave-plugins-official',
                        name: 'commit-commands',
                        description: 'Commands for git commit workflows including commit, push, and PR creation',
                        marketplace: 'wave-plugins-official',
                        installed: false,
                        version: '1.0.0'
                    },
                    {
                        id: 'document-skills@wave-plugins-official',
                        name: 'document-skills',
                        description: 'Collection of document processing suite including Excel, Word, PowerPoint, and PDF capabilities',
                        marketplace: 'wave-plugins-official',
                        installed: false,
                        version: '1.0.0'
                    },
                    {
                        id: 'typescript-lsp@wave-plugins-official',
                        name: 'typescript-lsp',
                        description: 'TypeScript/JavaScript language server for enhanced code intelligence',
                        marketplace: 'wave-plugins-official',
                        installed: false,
                        version: '1.0.0'
                    },
                    {
                        id: 'chrome-headless@wave-plugins-official',
                        name: 'chrome-headless',
                        description: 'Chrome DevTools Protocol MCP server for headless browser automation',
                        marketplace: 'wave-plugins-official',
                        installed: false,
                        version: '1.0.0'
                    },
                    {
                        id: 'sdd@wave-plugins-official',
                        name: 'sdd',
                        description: '规格驱动开发工作流，用于创建和管理技术规格文档',
                        marketplace: 'wave-plugins-official',
                        installed: false,
                        version: '1.0.0'
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
                        id: 'installed-plugin@wave-plugins-official',
                        name: 'Installed Plugin',
                        description: 'An already installed plugin',
                        marketplace: 'wave-plugins-official',
                        installed: true,
                        scope: 'user',
                        version: '1.0.0'
                    }
                ]
            }, '*');
        });

        await expect(webviewPage.locator('.plugin-name').filter({ hasText: 'Installed Plugin' })).toBeVisible();
        await webviewPage.screenshot({ path: '../../docs/public/screenshots/plugins-installed-tab.png' });

        // 4. Switch to "插件市场" tab
        await webviewPage.getByText('插件市场', { exact: true }).click();

        // Simulate receiving marketplaces list
        await webviewPage.evaluate(() => {
            window.postMessage({
                command: 'listMarketplacesResponse',
                marketplaces: [
                    { name: 'wave-plugins-official', url: 'https://github.com/wave-team/wave-plugins-official' }
                ]
            }, '*');
        });

        await expect(webviewPage.getByText('wave-plugins-official', { exact: true })).toBeVisible();
        await webviewPage.screenshot({ path: '../../docs/public/screenshots/plugins-marketplaces-tab.png' });
    });
});
