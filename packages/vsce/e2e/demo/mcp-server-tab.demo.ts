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
                        name: 'sqlite',
                        config: {
                            command: 'uvx',
                            args: ['mcp-server-sqlite', '--db-path', '/path/to/db.db']
                        },
                        status: 'connected',
                        toolCount: 5,
                        capabilities: ['tools'],
                        lastConnected: Date.now() - 60000
                    },
                    {
                        name: 'github',
                        config: {
                            command: 'npx',
                            args: ['-y', '@modelcontextprotocol/server-github'],
                            env: {
                                GITHUB_PERSONAL_ACCESS_TOKEN: 'your-token-here'
                            }
                        },
                        status: 'disconnected',
                        toolCount: 0,
                        capabilities: []
                    },
                    {
                        name: 'remote-server',
                        config: {
                            url: 'https://mcp-server.example.com/sse'
                        },
                        status: 'error',
                        toolCount: 0,
                        error: 'Connection refused',
                        capabilities: []
                    },
                    {
                        name: 'fetch',
                        config: {
                            command: 'npx',
                            args: ['-y', '@mcp/server-fetch']
                        },
                        status: 'connecting',
                        toolCount: 0,
                        capabilities: ['tools']
                    }
                ]
            }, '*');
        });

        // Verify all four servers are visible
        await expect(webviewPage.getByText('sqlite', { exact: true })).toBeVisible();
        await expect(webviewPage.getByText('github', { exact: true })).toBeVisible();
        await expect(webviewPage.getByText('remote-server', { exact: true })).toBeVisible();
        await expect(webviewPage.getByText('fetch', { exact: true })).toBeVisible();

        // Verify connected server shows tool count
        await expect(webviewPage.getByText('5 tools')).toBeVisible();

        // Verify error server shows error message
        await expect(webviewPage.getByText('Connection refused')).toBeVisible();

        // Verify connect button for disconnected server (two servers are not connected)
        await expect(webviewPage.getByRole('button', { name: '连接' }).first()).toBeVisible();

        // Verify disconnect button for connected server
        await expect(webviewPage.getByRole('button', { name: '断开' })).toBeVisible();

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
                        name: 'sqlite',
                        config: { command: 'uvx', args: ['mcp-server-sqlite'] },
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
                        name: 'sqlite',
                        config: { command: 'uvx', args: ['mcp-server-sqlite'] },
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
