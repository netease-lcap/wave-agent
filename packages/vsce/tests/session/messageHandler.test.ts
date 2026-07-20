import { describe, test, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────

vi.mock('vscode', () => ({
    window: {
        showInformationMessage: vi.fn(),
        showErrorMessage: vi.fn(),
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
});
