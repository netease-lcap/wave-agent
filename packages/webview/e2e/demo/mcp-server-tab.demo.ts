import { test, expect } from '../utils/webviewTestHarness.js';

test.describe('MCP Server Dialog Demo', () => {
    test('should show MCP server dialog with configured servers', async ({ webviewPage }) => {
        // 1. Open the MCP server management dialog via showDialog
        await webviewPage.evaluate(() => {
            window.simulateExtensionMessage({
                command: 'showDialog',
                dialogType: 'mcp'
            });
        });

        // Verify dialog is visible
        await expect(webviewPage.getByText('MCP 服务器', { exact: true })).toBeVisible();

        // 2. Simulate receiving MCP servers list
        await webviewPage.evaluate(() => {
            window.postMessage({
                command: 'mcpServersResponse',
                servers: [
                    {
                        name: 'jira',
                        config: {
                            command: 'npx',
                            args: ['-y', '@mcp/server-jira'],
                            env: { JIRA_API_TOKEN: 'your-token-here', JIRA_BASE_URL: 'https://nebula-tech.atlassian.net' }
                        },
                        status: 'connected',
                        toolCount: 8,
                        capabilities: ['tools'],
                        lastConnected: Date.now() - 60000
                    },
                    {
                        name: 'postgres',
                        config: {
                            command: 'uvx',
                            args: ['mcp-server-postgres', '--connection-string', 'postgresql://localhost:5432/nebula']
                        },
                        status: 'connected',
                        toolCount: 5,
                        capabilities: ['tools'],
                        lastConnected: Date.now() - 120000
                    },
                    {
                        name: 'github',
                        config: {
                            command: 'npx',
                            args: ['-y', '@modelcontextprotocol/server-github'],
                            env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_xxxxxxxxxxxx' }
                        },
                        status: 'disconnected',
                        toolCount: 0,
                        capabilities: []
                    },
                    {
                        name: 'sentry',
                        config: {
                            url: 'https://mcp.sentry.io/sse'
                        },
                        status: 'error',
                        toolCount: 0,
                        error: 'Authentication failed: invalid token',
                        capabilities: []
                    }
                ]
            }, '*');
        });

        // Verify all four servers are visible
        await expect(webviewPage.getByText('jira', { exact: true })).toBeVisible();
        await expect(webviewPage.getByText('github', { exact: true })).toBeVisible();
        await expect(webviewPage.getByText('sentry', { exact: true })).toBeVisible();
        await expect(webviewPage.getByText('postgres', { exact: true })).toBeVisible();

        // Verify connected server shows tool count
        await expect(webviewPage.getByText('5 tools')).toBeVisible();

        // Verify error server shows error message
        await expect(webviewPage.getByText('Authentication failed: invalid token')).toBeVisible();

        // Verify connect button for disconnected server (two servers are not connected)
        await expect(webviewPage.getByRole('button', { name: '连接' }).first()).toBeVisible();

        // Verify disconnect button for connected server
        await expect(webviewPage.getByRole('button', { name: '断开' }).first()).toBeVisible();

        await webviewPage.screenshot({ path: '../../docs/public/screenshots/spec-mcp-server-tab.png' });
    });

    test('should show empty state when no MCP servers configured', async ({ webviewPage }) => {
        // 1. Open the MCP server management dialog
        await webviewPage.evaluate(() => {
            window.simulateExtensionMessage({
                command: 'showDialog',
                dialogType: 'mcp'
            });
        });

        // 2. Simulate empty servers list
        await webviewPage.evaluate(() => {
            window.postMessage({
                command: 'mcpServersResponse',
                servers: []
            }, '*');
        });

        // Verify empty state message
        await expect(webviewPage.getByText('未配置 MCP 服务器')).toBeVisible();
        await expect(webviewPage.locator('code', { hasText: '.mcp.json' })).toBeVisible();

        await webviewPage.screenshot({ path: '../../docs/public/screenshots/spec-mcp-server-empty.png' });
    });

    test('should handle connect/disconnect actions', async ({ webviewPage }) => {
        // 1. Open the MCP server management dialog
        await webviewPage.evaluate(() => {
            window.simulateExtensionMessage({
                command: 'showDialog',
                dialogType: 'mcp'
            });
        });

        // 2. Simulate servers list
        await webviewPage.evaluate(() => {
            window.postMessage({
                command: 'mcpServersResponse',
                servers: [
                    {
                        name: 'jira',
                        config: { command: 'npx', args: ['-y', '@mcp/server-jira'] },
                        status: 'disconnected',
                        toolCount: 0,
                        capabilities: []
                    }
                ]
            }, '*');
        });

        // 3. Click connect button
        await webviewPage.getByRole('button', { name: '连接' }).click();

        // 4. Simulate the backend response after connection
        await webviewPage.evaluate(() => {
            window.postMessage({
                command: 'mcpServersResponse',
                servers: [
                    {
                        name: 'jira',
                        config: { command: 'npx', args: ['-y', '@mcp/server-jira'] },
                        status: 'connected',
                        toolCount: 5,
                        capabilities: ['tools'],
                        lastConnected: Date.now()
                    }
                ]
            }, '*');
        });

        // Verify status changed to connected and disconnect button appears
        await expect(webviewPage.getByRole('button', { name: '断开' })).toBeVisible();
        await expect(webviewPage.getByText('5 tools')).toBeVisible();
    });
});
