import { describe, test, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────

vi.mock('vscode', () => ({
    window: {
        showInformationMessage: vi.fn(),
        showErrorMessage: vi.fn(),
    },
    commands: {
        executeCommand: vi.fn(),
    },
}));

import * as vscode from 'vscode';
import { MessageHandler, type MessageHandlerContext } from '../../src/session/messageHandler';
import type { ChatSession } from '../../src/session/chatSession';
import type { McpServerStatus } from 'wave-agent-sdk';
import type { ConfigurationService } from '../../src/services/configurationService';
import type { FileService } from '../../src/services/fileService';
import type { SessionService } from '../../src/services/sessionService';
import type { PluginService } from '../../src/services/pluginService';
import type { StdioClient } from '../../src/stdio/stdioClient';

// ── Helpers ────────────────────────────────────────────────────

function createMockSession(): ChatSession {
    return {
        getMcpServers: vi.fn(),
        connectMcpServer: vi.fn(),
        disconnectMcpServer: vi.fn(),
        compact: vi.fn(),
        getSlashCommands: vi.fn().mockResolvedValue([]),
        getMessages: vi.fn().mockResolvedValue([]),
        askBtw: vi.fn(),
    } as unknown as ChatSession;
}

function createHandler(session: ChatSession) {
    const context: MessageHandlerContext = {
        getChatSession: vi.fn().mockReturnValue(session),
        postMessage: vi.fn(),
        initializeAgent: vi.fn(),
        listSessions: vi.fn(),
        updateAllSessionsConfig: vi.fn(),
        checkForUpdates: vi.fn(),
        getVersion: vi.fn().mockReturnValue('1.2.3'),
    };
    const handler = new MessageHandler(
        {} as unknown as ConfigurationService,
        {} as unknown as FileService,
        {} as unknown as SessionService,
        {} as unknown as PluginService,
        {} as unknown as StdioClient,
        context
    );
    return { handler, context };
}

function createReadySession(): ChatSession {
    return {
        agent: { getPermissionMode: vi.fn(), workingDirectory: '/tmp', latestTotalTokens: 0 },
        pendingConfirmations: new Map(),
        messages: [],
        tasks: [],
        messageQueue: [],
        sessionId: undefined,
        inputContent: '',
        isStreaming: false,
        isCommandRunning: false,
        getMessages: vi.fn().mockResolvedValue([]),
    } as unknown as ChatSession;
}

function createReadyHandler(session: ChatSession) {
    const configService = {
        loadConfiguration: vi.fn().mockResolvedValue({ serverUrl: '', language: 'Chinese' }),
        saveConfiguration: vi.fn(),
    };
    const sessionService = {
        getSessionsList: vi.fn().mockResolvedValue([]),
    };
    const utilityClient = {
        request: vi.fn().mockResolvedValue({ isAuthenticated: true, serverUrl: 'https://console.example.com' }),
    };
    const context: MessageHandlerContext = {
        getChatSession: vi.fn().mockReturnValue(session),
        postMessage: vi.fn(),
        initializeAgent: vi.fn(),
        listSessions: vi.fn(),
        updateAllSessionsConfig: vi.fn(),
        checkForUpdates: vi.fn(),
        getVersion: vi.fn().mockReturnValue('1.2.3'),
    } as unknown as MessageHandlerContext;
    const handler = new MessageHandler(
        configService as unknown as ConfigurationService,
        {} as unknown as FileService,
        sessionService as unknown as SessionService,
        {} as unknown as PluginService,
        utilityClient as unknown as StdioClient,
        context
    );
    return { handler, context, configService, sessionService, utilityClient };
}

// ── Tests ──────────────────────────────────────────────────────

describe('MessageHandler MCP handlers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // Regression for missing `await` on session.getMcpServers().
    // If await is removed, `servers` sent to postMessage is a Promise,
    // which would fail Array.isArray and .map downstream.
    test('getMcpServers posts resolved array (regression for missing await)', async () => {
        const servers = [
            { name: 's1', status: 'connected', toolCount: 3 },
        ] as unknown as McpServerStatus[];
        const session = createMockSession();
        (session.getMcpServers as ReturnType<typeof vi.fn>).mockResolvedValue(servers);

        const { handler, context } = createHandler(session);
        await handler.handleMessage({ command: 'getMcpServers' }, 'tab');

        expect(context.getChatSession).toHaveBeenCalledWith('tab', undefined);
        expect(context.postMessage).toHaveBeenCalledTimes(1);
        const posted = (context.postMessage as ReturnType<typeof vi.fn>).mock.calls[0][0] as { command: string; servers: unknown };
        expect(posted.command).toBe('mcpServersResponse');
        expect(Array.isArray(posted.servers)).toBe(true);
        expect(posted.servers).toEqual(servers);
    });

    test('getMcpServers posts empty array when no servers', async () => {
        const session = createMockSession();
        (session.getMcpServers as ReturnType<typeof vi.fn>).mockResolvedValue([]);

        const { handler, context } = createHandler(session);
        await handler.handleMessage({ command: 'getMcpServers' }, 'tab');

        const posted = (context.postMessage as ReturnType<typeof vi.fn>).mock.calls[0][0] as { command: string; servers: unknown };
        expect(posted.command).toBe('mcpServersResponse');
        expect(Array.isArray(posted.servers)).toBe(true);
        expect(posted.servers).toEqual([]);
    });

    test('connectMcpServer shows info message on success', async () => {
        const session = createMockSession();
        (session.connectMcpServer as ReturnType<typeof vi.fn>).mockResolvedValue(true);

        const { handler } = createHandler(session);
        await handler.handleMessage({ command: 'connectMcpServer', serverName: 'my-server' }, 'tab');

        expect(session.connectMcpServer).toHaveBeenCalledWith('my-server');
        expect(vscode.window.showInformationMessage).toHaveBeenCalledTimes(1);
        expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    });

    test('connectMcpServer shows error message on failure', async () => {
        const session = createMockSession();
        (session.connectMcpServer as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'));

        const { handler } = createHandler(session);
        await handler.handleMessage({ command: 'connectMcpServer', serverName: 'bad-server' }, 'tab');

        expect(vscode.window.showErrorMessage).toHaveBeenCalledTimes(1);
        expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
    });

    test('disconnectMcpServer shows info message on success', async () => {
        const session = createMockSession();
        (session.disconnectMcpServer as ReturnType<typeof vi.fn>).mockResolvedValue(true);

        const { handler } = createHandler(session);
        await handler.handleMessage({ command: 'disconnectMcpServer', serverName: 'my-server' }, 'tab');

        expect(session.disconnectMcpServer).toHaveBeenCalledWith('my-server');
        expect(vscode.window.showInformationMessage).toHaveBeenCalledTimes(1);
        expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    });

    test('disconnectMcpServer shows error message on failure', async () => {
        const session = createMockSession();
        (session.disconnectMcpServer as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'));

        const { handler } = createHandler(session);
        await handler.handleMessage({ command: 'disconnectMcpServer', serverName: 'bad-server' }, 'tab');

        expect(vscode.window.showErrorMessage).toHaveBeenCalledTimes(1);
        expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
    });

    // Regression: setInitialState.configurationData.serverUrl must reflect the
    // serverUrl freshly fetched from getAuthStatus, not the stale/empty value
    // loaded before saveConfiguration. A stale empty serverUrl would silently
    // break the "enterprise console" action in the webview.
    test('webviewReady sends fresh serverUrl from getAuthStatus in setInitialState', async () => {
        const session = createReadySession();
        const { handler, context, configService, utilityClient } = createReadyHandler(session);

        await handler.handleMessage({ command: 'webviewReady' }, 'tab');

        expect(utilityClient.request).toHaveBeenCalledWith('getAuthStatus');
        expect(configService.saveConfiguration).toHaveBeenCalledWith({ serverUrl: 'https://console.example.com' });

        const posted = (context.postMessage as ReturnType<typeof vi.fn>).mock.calls
            .map((call) => call[0])
            .find((msg) => msg.command === 'setInitialState') as { configurationData: { serverUrl: string }; isAuthenticated: boolean };

        expect(posted).toBeDefined();
        expect(posted.configurationData.serverUrl).toBe('https://console.example.com');
        expect(posted.isAuthenticated).toBe(true);
    });

    // Regression: /status showed empty version in VSCE because handleGetStatus
    // looked up the extension by a wrong, hardcoded id ('wave-code.wave-vsce-chat')
    // instead of the real id ('wave-code.wave-vsce'), so getExtension() returned
    // undefined. Version is now sourced from context.getVersion() (backed by the
    // extension's own packageJSON), consistent with chatProvider/updateService.
    test('getStatus posts version from context.getVersion', async () => {
        const session = createReadySession();
        const { handler, context } = createReadyHandler(session);

        await handler.handleMessage({ command: 'getStatus' }, 'tab');

        expect(context.getVersion).toHaveBeenCalled();
        const posted = (context.postMessage as ReturnType<typeof vi.fn>).mock.calls[0][0] as { command: string; version: string };
        expect(posted.command).toBe('statusResponse');
        expect(posted.version).toBe('1.2.3');
    });

    // /compact command: mirrors /clear — the webview posts { command: 'compact', customInstructions }
    // and the handler delegates to session.compact(customInstructions).
    test('compact command calls session.compact with customInstructions', async () => {
        const session = createMockSession();
        (session.compact as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

        const { handler } = createHandler(session);
        await handler.handleMessage({ command: 'compact', customInstructions: 'focus on API' }, 'tab');

        expect(session.compact).toHaveBeenCalledWith('focus on API');
    });

    test('compact command calls session.compact with undefined when no instructions', async () => {
        const session = createMockSession();
        (session.compact as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

        const { handler } = createHandler(session);
        await handler.handleMessage({ command: 'compact' }, 'tab');

        expect(session.compact).toHaveBeenCalledWith(undefined);
    });

    test('slashCommandsRequest includes compact in localCommands', async () => {
        const session = createMockSession();

        const { handler, context } = createHandler(session);
        await handler.handleMessage({ command: 'requestSlashCommands', filterText: '' }, 'tab');

        const posted = (context.postMessage as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
            command: string;
            commands: Array<{ id: string; name: string; description: string }>;
        };
        expect(posted.command).toBe('slashCommandsResponse');
        const compact = posted.commands.find(c => c.id === 'compact');
        expect(compact).toBeDefined();
        expect(compact?.name).toBe('compact');
    });

    // /btw command: webview posts { command: 'askBtw', question } and the handler
    // delegates to session.askBtw, echoing the question back so the webview can
    // match the reply against its in-flight panel (dropping stale replies).
    test('askBtw posts btwResponse with answer and echoed question', async () => {
        const session = createMockSession();
        (session.askBtw as ReturnType<typeof vi.fn>).mockResolvedValue('**Sunny** weather');

        const { handler, context } = createHandler(session);
        await handler.handleMessage({ command: 'askBtw', question: 'weather?' }, 'tab');

        expect(session.askBtw).toHaveBeenCalledWith('weather?');
        const posted = (context.postMessage as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
            command: string;
            question: string;
            answer: string;
        };
        expect(posted.command).toBe('btwResponse');
        expect(posted.question).toBe('weather?');
        expect(posted.answer).toBe('**Sunny** weather');
    });

    test('askBtw posts btwError when session.askBtw rejects', async () => {
        const session = createMockSession();
        (session.askBtw as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('agent not initialized'));

        const { handler, context } = createHandler(session);
        await handler.handleMessage({ command: 'askBtw', question: 'weather?' }, 'tab');

        const posted = (context.postMessage as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
            command: string;
            question: string;
            error: string;
        };
        expect(posted.command).toBe('btwError');
        expect(posted.question).toBe('weather?');
        expect(posted.error).toContain('agent not initialized');
    });

    test('slashCommandsRequest includes btw in localCommands', async () => {
        const session = createMockSession();

        const { handler, context } = createHandler(session);
        await handler.handleMessage({ command: 'requestSlashCommands', filterText: '' }, 'tab');

        const posted = (context.postMessage as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
            command: string;
            commands: Array<{ id: string; name: string; description: string }>;
        };
        expect(posted.command).toBe('slashCommandsResponse');
        const btw = posted.commands.find(c => c.id === 'btw');
        expect(btw).toBeDefined();
        expect(btw?.name).toBe('btw');
        expect(btw?.description).toContain('旁路');
    });

    // Toggling a project-level builtin plugin (e.g. sdd@builtin) must recreate
    // agents — same as handleEnablePlugin — so the change takes effect, not just
    // refresh the projectSettings panel.
    test('setBuiltinPluginEnabled reloads config and recreates agents on success', async () => {
        const configService = {
            loadConfiguration: vi.fn().mockResolvedValue({ serverUrl: '', language: 'Chinese' }),
            saveConfiguration: vi.fn(),
        };
        const pluginService = {
            setBuiltinPluginEnabled: vi.fn().mockResolvedValue({ enabledPlugins: { 'sdd@builtin': true } }),
        };
        const context: MessageHandlerContext = {
            getChatSession: vi.fn().mockReturnValue(createMockSession()),
            postMessage: vi.fn(),
            initializeAgent: vi.fn(),
            listSessions: vi.fn(),
            updateAllSessionsConfig: vi.fn(),
            checkForUpdates: vi.fn(),
            getVersion: vi.fn().mockReturnValue('1.2.3'),
        };
        const handler = new MessageHandler(
            configService as unknown as ConfigurationService,
            {} as unknown as FileService,
            {} as unknown as SessionService,
            pluginService as unknown as PluginService,
            {} as unknown as StdioClient,
            context
        );

        await handler.handleMessage({ command: 'setBuiltinPluginEnabled', pluginId: 'sdd@builtin', enabled: true, scope: 'project' }, 'tab');

        expect(pluginService.setBuiltinPluginEnabled).toHaveBeenCalledWith('sdd@builtin', true, 'project');
        expect(configService.loadConfiguration).toHaveBeenCalled();
        expect(context.updateAllSessionsConfig).toHaveBeenCalledWith({ serverUrl: '', language: 'Chinese' });

        const posted = (context.postMessage as ReturnType<typeof vi.fn>).mock.calls[0][0] as { command: string; enabledPlugins: Record<string, boolean> };
        expect(posted.command).toBe('projectSettings');
        expect(posted.enabledPlugins).toEqual({ 'sdd@builtin': true });
    });
});
