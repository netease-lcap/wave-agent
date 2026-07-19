import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { StdioClient } from '../../src/stdio/stdioClient';
import { StdioAgent } from '../../src/stdio/stdioAgent';
import { NotificationRouter } from '../../src/stdio/notificationRouter';
import type { Message, Task, QueuedMessage, PermissionMode, ToolPermissionContext } from 'wave-agent-sdk';

// ── Mock StdioClient ───────────────────────────────────────────

interface MockClient {
    request: ReturnType<typeof vi.fn>;
    notify: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    onNotification: ReturnType<typeof vi.fn>;
    offNotification: ReturnType<typeof vi.fn>;
}

function createMockClient(): MockClient {
    return {
        request: vi.fn(),
        notify: vi.fn(),
        dispose: vi.fn(),
        onNotification: vi.fn(),
        offNotification: vi.fn(),
    };
}

// Collect notification handlers registered on the client (by the router)
function getNotificationHandlers(client: MockClient): Map<string, (params: unknown, sessionId?: string) => void> {
    const handlers = new Map<string, (params: unknown, sessionId?: string) => void>();
    for (const call of client.onNotification.mock.calls) {
        const [method, handler] = call as [string, (params: unknown, sessionId?: string) => void];
        handlers.set(method, handler);
    }
    return handlers;
}

function createAgent(callbacks: Record<string, (...args: unknown[]) => void> = {}) {
    const client = createMockClient();
    const router = new NotificationRouter(client as unknown as StdioClient);
    router.attach();
    const agent = new StdioAgent(
        client as unknown as StdioClient,
        router,
        callbacks,
    );
    return { agent, client, router, handlers: getNotificationHandlers(client) };
}

describe('StdioAgent', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // ── Construction ───────────────────────────────────────────

    it('router attaches notification handlers for all notification types', () => {
        const { client } = createAgent();

        const registeredMethods = client.onNotification.mock.calls.map(
            (c) => c[0] as string,
        );
        expect(registeredMethods).toContain('messagesChange');
        expect(registeredMethods).toContain('userMessageAdded');
        expect(registeredMethods).toContain('assistantMessageAdded');
        expect(registeredMethods).toContain('assistantContentUpdated');
        expect(registeredMethods).toContain('assistantReasoningUpdated');
        expect(registeredMethods).toContain('toolBlockUpdated');
        expect(registeredMethods).toContain('errorBlockAdded');
        expect(registeredMethods).toContain('loadingChange');
        expect(registeredMethods).toContain('commandRunningChange');
        expect(registeredMethods).toContain('queuedMessagesChange');
        expect(registeredMethods).toContain('tasksChange');
        expect(registeredMethods).toContain('sessionIdChange');
        expect(registeredMethods).toContain('permissionModeChange');
        expect(registeredMethods).toContain('mcpServersChange');
        expect(registeredMethods).toContain('bangMessageAdded');
        expect(registeredMethods).toContain('bangMessageUpdated');
        expect(registeredMethods).toContain('bangMessageCompleted');
        expect(registeredMethods).toContain('notificationMessageAdded');
        expect(registeredMethods).toContain('permissionRequest');
        expect(registeredMethods).toContain('authUrl');
    });

    // ── initialize ─────────────────────────────────────────────

    it('sends initialize request, caches returned state, and registers with router', async () => {
        const { agent, client, router } = createAgent();

        client.request.mockResolvedValue({
            sessionId: 'session-123',
            workingDirectory: '/workspace',
            permissionMode: 'default',
            latestTotalTokens: 500,
        });

        const registerSpy = vi.spyOn(router, 'register');

        const result = await agent.initialize({ workdir: '/workspace' });

        expect(client.request).toHaveBeenCalledWith('initialize', { workdir: '/workspace' });
        expect(result).toEqual({
            sessionId: 'session-123',
            workingDirectory: '/workspace',
            permissionMode: 'default',
            latestTotalTokens: 500,
        });
        expect(agent.sessionId).toBe('session-123');
        expect(agent.workingDirectory).toBe('/workspace');
        expect(agent.permissionMode).toBe('default');
        expect(agent.latestTotalTokens).toBe(500);
        expect(registerSpy).toHaveBeenCalledWith('session-123', agent);
    });

    // ── destroy ────────────────────────────────────────────────

    it('sends destroy request with sessionId, unregisters router, does NOT dispose client', async () => {
        const { agent, client, router } = createAgent();
        client.request.mockResolvedValue({
            sessionId: 'session-123',
            workingDirectory: '/w',
            permissionMode: 'default',
            latestTotalTokens: 0,
        });
        await agent.initialize({ workdir: '/w' });

        const unregisterSpy = vi.spyOn(router, 'unregister');
        client.request.mockClear();

        await agent.destroy();

        expect(unregisterSpy).toHaveBeenCalledWith('session-123');
        expect(client.request).toHaveBeenCalledWith('destroy', undefined, 'session-123');
        expect(client.dispose).not.toHaveBeenCalled();
    });

    it('destroy swallows request failure and still does not dispose client', async () => {
        const { agent, client } = createAgent();
        client.request.mockResolvedValue({
            sessionId: 'session-123',
            workingDirectory: '/w',
            permissionMode: 'default',
            latestTotalTokens: 0,
        });
        await agent.initialize({ workdir: '/w' });

        client.request.mockRejectedValue(new Error('destroy failed'));

        await expect(agent.destroy()).resolves.toBeUndefined();
        expect(client.dispose).not.toHaveBeenCalled();
    });

    // ── sendMessage ────────────────────────────────────────────

    it('sends sendMessage with text, images, force, and sessionId', async () => {
        const { agent, client } = createAgent();
        client.request.mockResolvedValue({
            sessionId: 'session-123',
            workingDirectory: '/w',
            permissionMode: 'default',
            latestTotalTokens: 0,
        });
        await agent.initialize({ workdir: '/w' });
        client.request.mockClear();

        const images = [{ path: '/img.png', mimeType: 'image/png' }];
        await agent.sendMessage('hello', images, true);

        expect(client.request).toHaveBeenCalledWith('sendMessage', {
            text: 'hello',
            images,
            force: true,
        }, 'session-123');
    });

    it('sends sendMessage with minimal args and sessionId', async () => {
        const { agent, client } = createAgent();
        client.request.mockResolvedValue({
            sessionId: 'session-123',
            workingDirectory: '/w',
            permissionMode: 'default',
            latestTotalTokens: 0,
        });
        await agent.initialize({ workdir: '/w' });
        client.request.mockClear();

        await agent.sendMessage('hello');

        expect(client.request).toHaveBeenCalledWith('sendMessage', {
            text: 'hello',
            images: undefined,
            force: undefined,
        }, 'session-123');
    });

    // ── bang ───────────────────────────────────────────────────

    it('sends bang request with sessionId', async () => {
        const { agent, client } = createAgent();
        client.request.mockResolvedValue({
            sessionId: 'session-123',
            workingDirectory: '/w',
            permissionMode: 'default',
            latestTotalTokens: 0,
        });
        await agent.initialize({ workdir: '/w' });
        client.request.mockClear();

        await agent.bang('git status');

        expect(client.request).toHaveBeenCalledWith('bang', { command: 'git status' }, 'session-123');
    });

    // ── abortMessage ───────────────────────────────────────────

    it('sends abortMessage request with sessionId', async () => {
        const { agent, client } = createAgent();
        client.request.mockResolvedValue({
            sessionId: 'session-123',
            workingDirectory: '/w',
            permissionMode: 'default',
            latestTotalTokens: 0,
        });
        await agent.initialize({ workdir: '/w' });
        client.request.mockClear();

        await agent.abortMessage();

        expect(client.request).toHaveBeenCalledWith('abortMessage', undefined, 'session-123');
    });

    // ── clearMessages ──────────────────────────────────────────

    it('sends clearMessages request with sessionId', async () => {
        const { agent, client } = createAgent();
        client.request.mockResolvedValue({
            sessionId: 'session-123',
            workingDirectory: '/w',
            permissionMode: 'default',
            latestTotalTokens: 0,
        });
        await agent.initialize({ workdir: '/w' });
        client.request.mockClear();

        await agent.clearMessages();

        expect(client.request).toHaveBeenCalledWith('clearMessages', undefined, 'session-123');
    });

    // ── rewindToMessage ────────────────────────────────────────

    it('sends rewindToMessage with sessionId and returns inputContent', async () => {
        const { agent, client } = createAgent();
        client.request.mockResolvedValue({
            sessionId: 'session-123',
            workingDirectory: '/w',
            permissionMode: 'default',
            latestTotalTokens: 0,
        });
        await agent.initialize({ workdir: '/w' });
        client.request.mockResolvedValue({ inputContent: 'previous text' });

        const result = await agent.rewindToMessage('msg-1');

        expect(client.request).toHaveBeenCalledWith('rewindToMessage', { messageId: 'msg-1' }, 'session-123');
        expect(result).toEqual({ inputContent: 'previous text' });
    });

    // ── removeQueuedMessage ────────────────────────────────────

    it('sends deleteQueuedMessage with index and sessionId', async () => {
        const { agent, client } = createAgent();
        client.request.mockResolvedValue({
            sessionId: 'session-123',
            workingDirectory: '/w',
            permissionMode: 'default',
            latestTotalTokens: 0,
        });
        await agent.initialize({ workdir: '/w' });
        client.request.mockClear();

        await agent.removeQueuedMessage(2);

        expect(client.request).toHaveBeenCalledWith('deleteQueuedMessage', { index: 2 }, 'session-123');
    });

    // ── getFullMessageThread ───────────────────────────────────

    it('returns messages and sessionIds with sessionId in request', async () => {
        const { agent, client } = createAgent();
        client.request.mockResolvedValue({
            sessionId: 'session-123',
            workingDirectory: '/w',
            permissionMode: 'default',
            latestTotalTokens: 0,
        });
        await agent.initialize({ workdir: '/w' });
        client.request.mockResolvedValue({
            messages: [{ id: 'm1' }],
            sessionIds: ['s1', 's2'],
        });

        const result = await agent.getFullMessageThread();

        expect(client.request).toHaveBeenCalledWith('getFullMessageThread', undefined, 'session-123');
        expect(result).toEqual({
            messages: [{ id: 'm1' }],
            sessionIds: ['s1', 's2'],
        });
    });

    // ── updateConfig ───────────────────────────────────────────

    it('sends updateConfig with sessionId and re-registers router when sessionId changes', async () => {
        const { agent, client, router } = createAgent();
        client.request.mockResolvedValue({
            sessionId: 'old-session',
            workingDirectory: '/w',
            permissionMode: 'default',
            latestTotalTokens: 0,
        });
        await agent.initialize({ workdir: '/w' });

        const registerSpy = vi.spyOn(router, 'register');
        const unregisterSpy = vi.spyOn(router, 'unregister');
        client.request.mockResolvedValue({ sessionId: 'new-session' });

        const result = await agent.updateConfig({ model: 'gpt-4' });

        expect(client.request).toHaveBeenCalledWith('updateConfig', { model: 'gpt-4' }, 'old-session');
        expect(result).toEqual({ sessionId: 'new-session' });
        expect(unregisterSpy).toHaveBeenCalledWith('old-session');
        expect(registerSpy).toHaveBeenCalledWith('new-session', agent);
        expect(agent.sessionId).toBe('new-session');
    });

    it('does not re-register router when sessionId unchanged by updateConfig', async () => {
        const { agent, client, router } = createAgent();
        client.request.mockResolvedValue({
            sessionId: 'same-session',
            workingDirectory: '/w',
            permissionMode: 'default',
            latestTotalTokens: 0,
        });
        await agent.initialize({ workdir: '/w' });

        const registerSpy = vi.spyOn(router, 'register');
        const unregisterSpy = vi.spyOn(router, 'unregister');
        client.request.mockResolvedValue({ sessionId: 'same-session' });

        await agent.updateConfig({ model: 'gpt-4' });

        expect(unregisterSpy).not.toHaveBeenCalled();
        expect(registerSpy).not.toHaveBeenCalled();
    });

    // ── restoreSession ─────────────────────────────────────────

    it('sends restoreSession request with sessionId', async () => {
        const { agent, client } = createAgent();
        client.request.mockResolvedValue({
            sessionId: 'session-123',
            workingDirectory: '/w',
            permissionMode: 'default',
            latestTotalTokens: 0,
        });
        await agent.initialize({ workdir: '/w' });
        client.request.mockClear();

        await agent.restoreSession('old-session-id');

        expect(client.request).toHaveBeenCalledWith('restoreSession', { sessionId: 'old-session-id' }, 'session-123');
    });

    // ── setPermissionMode ──────────────────────────────────────

    it('sends setPermissionMode request with sessionId', async () => {
        const { agent, client } = createAgent();
        client.request.mockResolvedValue({
            sessionId: 'session-123',
            workingDirectory: '/w',
            permissionMode: 'default',
            latestTotalTokens: 0,
        });
        await agent.initialize({ workdir: '/w' });
        client.request.mockClear();

        await agent.setPermissionMode('plan' as PermissionMode);

        expect(client.request).toHaveBeenCalledWith('setPermissionMode', { mode: 'plan' }, 'session-123');
    });

    it('getPermissionMode returns cached value', () => {
        const { agent } = createAgent();

        expect(agent.getPermissionMode()).toBeUndefined();

        // Simulate notification changing the mode
        (agent as unknown as { permissionMode: PermissionMode }).permissionMode = 'bypassPermissions';
        expect(agent.getPermissionMode()).toBe('bypassPermissions');
    });

    // ── sendPermissionResponse ─────────────────────────────────

    it('sends permissionResponse as notification with sessionId', async () => {
        const { agent, client } = createAgent();
        client.request.mockResolvedValue({
            sessionId: 'session-123',
            workingDirectory: '/w',
            permissionMode: 'default',
            latestTotalTokens: 0,
        });
        await agent.initialize({ workdir: '/w' });

        agent.sendPermissionResponse('req-1', 'allow' as never);

        expect(client.notify).toHaveBeenCalledWith('permissionResponse', {
            requestId: 'req-1',
            decision: 'allow',
        }, 'session-123');
        expect(client.request).not.toHaveBeenCalledWith('permissionResponse', expect.anything(), expect.anything());
    });

    // ── MCP ────────────────────────────────────────────────────

    it('getMcpServers unwraps servers from result with sessionId', async () => {
        const { agent, client } = createAgent();
        client.request.mockResolvedValue({
            sessionId: 'session-123',
            workingDirectory: '/w',
            permissionMode: 'default',
            latestTotalTokens: 0,
        });
        await agent.initialize({ workdir: '/w' });
        const servers = [{ name: 'server1', status: 'connected' }];
        client.request.mockResolvedValue({ servers });

        const result = await agent.getMcpServers();

        expect(client.request).toHaveBeenCalledWith('getMcpServers', undefined, 'session-123');
        expect(result).toEqual(servers);
    });

    it('connectMcpServer returns success boolean with sessionId', async () => {
        const { agent, client } = createAgent();
        client.request.mockResolvedValue({
            sessionId: 'session-123',
            workingDirectory: '/w',
            permissionMode: 'default',
            latestTotalTokens: 0,
        });
        await agent.initialize({ workdir: '/w' });
        client.request.mockResolvedValue({ success: true });

        const result = await agent.connectMcpServer('my-server');

        expect(client.request).toHaveBeenCalledWith('connectMcpServer', { serverName: 'my-server' }, 'session-123');
        expect(result).toBe(true);
    });

    it('disconnectMcpServer returns success boolean with sessionId', async () => {
        const { agent, client } = createAgent();
        client.request.mockResolvedValue({
            sessionId: 'session-123',
            workingDirectory: '/w',
            permissionMode: 'default',
            latestTotalTokens: 0,
        });
        await agent.initialize({ workdir: '/w' });
        client.request.mockResolvedValue({ success: false });

        const result = await agent.disconnectMcpServer('my-server');

        expect(client.request).toHaveBeenCalledWith('disconnectMcpServer', { serverName: 'my-server' }, 'session-123');
        expect(result).toBe(false);
    });

    // ── getSlashCommands ───────────────────────────────────────

    it('unwraps commands from result with sessionId', async () => {
        const { agent, client } = createAgent();
        client.request.mockResolvedValue({
            sessionId: 'session-123',
            workingDirectory: '/w',
            permissionMode: 'default',
            latestTotalTokens: 0,
        });
        await agent.initialize({ workdir: '/w' });
        const commands = [{ name: 'compact', description: 'Compact' }];
        client.request.mockResolvedValue({ commands });

        const result = await agent.getSlashCommands();

        expect(client.request).toHaveBeenCalledWith('getSlashCommands', undefined, 'session-123');
        expect(result).toEqual(commands);
    });

    // ── handleNotification (called by NotificationRouter) ──────

    it('messagesChange updates cached messages and calls callback', () => {
        const onMessagesChange = vi.fn();
        const { agent } = createAgent({ onMessagesChange });

        const messages: Message[] = [
            { id: 'm1', role: 'user', timestamp: '', blocks: [] },
        ];
        agent.handleNotification('messagesChange', { messages });

        expect(agent.messages).toEqual(messages);
        expect(onMessagesChange).toHaveBeenCalledWith(messages);
    });

    it('userMessageAdded forwards message to callback', () => {
        const onUserMessageAdded = vi.fn();
        const { agent } = createAgent({ onUserMessageAdded });

        const message: Message = { id: 'm1', role: 'user', timestamp: '', blocks: [] };
        agent.handleNotification('userMessageAdded', { message });

        expect(onUserMessageAdded).toHaveBeenCalledWith(message);
    });

    it('userMessageAdded does not call callback when message is undefined', () => {
        const onUserMessageAdded = vi.fn();
        const { agent } = createAgent({ onUserMessageAdded });

        agent.handleNotification('userMessageAdded', { message: undefined });

        expect(onUserMessageAdded).not.toHaveBeenCalled();
    });

    it('assistantMessageAdded forwards message to callback', () => {
        const onAssistantMessageAdded = vi.fn();
        const { agent } = createAgent({ onAssistantMessageAdded });

        const message: Message = { id: 'a1', role: 'assistant', timestamp: '', blocks: [] };
        agent.handleNotification('assistantMessageAdded', { message });

        expect(onAssistantMessageAdded).toHaveBeenCalledWith(message);
    });

    it('assistantContentUpdated forwards params to callback', () => {
        const onAssistantContentUpdated = vi.fn();
        const { agent } = createAgent({ onAssistantContentUpdated });

        const params = { messageId: 'a1', accumulated: 'hello', stage: 'streaming' as const };
        agent.handleNotification('assistantContentUpdated', params);

        expect(onAssistantContentUpdated).toHaveBeenCalledWith(params);
    });

    it('assistantReasoningUpdated forwards params to callback', () => {
        const onAssistantReasoningUpdated = vi.fn();
        const { agent } = createAgent({ onAssistantReasoningUpdated });

        const params = { messageId: 'a1', accumulated: 'thinking', stage: 'end' as const };
        agent.handleNotification('assistantReasoningUpdated', params);

        expect(onAssistantReasoningUpdated).toHaveBeenCalledWith(params);
    });

    it('toolBlockUpdated forwards params to callback', () => {
        const onToolBlockUpdated = vi.fn();
        const { agent } = createAgent({ onToolBlockUpdated });

        const params = { toolName: 'bash', toolCallId: 'tc1', status: 'running' };
        agent.handleNotification('toolBlockUpdated', params);

        expect(onToolBlockUpdated).toHaveBeenCalledWith(params);
    });

    it('errorBlockAdded forwards error string to callback', () => {
        const onErrorBlockAdded = vi.fn();
        const { agent } = createAgent({ onErrorBlockAdded });

        agent.handleNotification('errorBlockAdded', { error: 'Something went wrong' });

        expect(onErrorBlockAdded).toHaveBeenCalledWith('Something went wrong');
    });

    it('loadingChange updates latestTotalTokens and calls callback', () => {
        const onLoadingChange = vi.fn();
        const { agent } = createAgent({ onLoadingChange });

        agent.handleNotification('loadingChange', { loading: true, latestTotalTokens: 1000 });

        expect(agent.latestTotalTokens).toBe(1000);
        expect(onLoadingChange).toHaveBeenCalledWith(true);
    });

    it('loadingChange does not update latestTotalTokens when undefined', () => {
        const onLoadingChange = vi.fn();
        const { agent } = createAgent({ onLoadingChange });

        agent.latestTotalTokens = 500;
        agent.handleNotification('loadingChange', { loading: false });

        expect(agent.latestTotalTokens).toBe(500);
        expect(onLoadingChange).toHaveBeenCalledWith(false);
    });

    it('commandRunningChange forwards running boolean', () => {
        const onCommandRunningChange = vi.fn();
        const { agent } = createAgent({ onCommandRunningChange });

        agent.handleNotification('commandRunningChange', { running: true });

        expect(onCommandRunningChange).toHaveBeenCalledWith(true);
    });

    it('queuedMessagesChange updates cached queue and calls callback', () => {
        const onQueuedMessagesChange = vi.fn();
        const { agent } = createAgent({ onQueuedMessagesChange });

        const queue: QueuedMessage[] = [{ content: 'queued msg' }];
        agent.handleNotification('queuedMessagesChange', { messages: queue });

        expect(agent.queuedMessages).toEqual(queue);
        expect(onQueuedMessagesChange).toHaveBeenCalledWith(queue);
    });

    it('tasksChange updates cached tasks and calls callback', () => {
        const onTasksChange = vi.fn();
        const { agent } = createAgent({ onTasksChange });

        const tasks: Task[] = [{ id: 't1', subject: 'Task 1', description: 'desc', status: 'pending', blocks: [], blockedBy: [], metadata: {} }];
        agent.handleNotification('tasksChange', { tasks });

        expect(agent.tasks).toEqual(tasks);
        expect(onTasksChange).toHaveBeenCalledWith(tasks);
    });

    it('sessionIdChange updates cached sessionId and calls callback', () => {
        const onSessionIdChange = vi.fn();
        const { agent } = createAgent({ onSessionIdChange });

        agent.handleNotification('sessionIdChange', { sessionId: 'new-session' });

        expect(agent.sessionId).toBe('new-session');
        expect(onSessionIdChange).toHaveBeenCalledWith('new-session');
    });

    it('permissionModeChange updates cached mode and calls callback', () => {
        const onPermissionModeChange = vi.fn();
        const { agent } = createAgent({ onPermissionModeChange });

        agent.handleNotification('permissionModeChange', { mode: 'plan' });

        expect(agent.permissionMode).toBe('plan');
        expect(onPermissionModeChange).toHaveBeenCalledWith('plan');
    });

    it('mcpServersChange forwards servers to callback', () => {
        const onMcpServersChange = vi.fn();
        const { agent } = createAgent({ onMcpServersChange });

        const servers = [{ name: 's1', status: 'connected' }];
        agent.handleNotification('mcpServersChange', { servers });

        expect(onMcpServersChange).toHaveBeenCalledWith(servers);
    });

    it('bangMessageAdded/Updated/Completed call respective callbacks', () => {
        const onBangMessageAdded = vi.fn();
        const onBangMessageUpdated = vi.fn();
        const onBangMessageCompleted = vi.fn();
        const { agent } = createAgent({
            onBangMessageAdded,
            onBangMessageUpdated,
            onBangMessageCompleted,
        });

        agent.handleNotification('bangMessageAdded', undefined);
        agent.handleNotification('bangMessageUpdated', undefined);
        agent.handleNotification('bangMessageCompleted', undefined);

        expect(onBangMessageAdded).toHaveBeenCalled();
        expect(onBangMessageUpdated).toHaveBeenCalled();
        expect(onBangMessageCompleted).toHaveBeenCalled();
    });

    it('notificationMessageAdded forwards params to callback', () => {
        const onNotificationMessageAdded = vi.fn();
        const { agent } = createAgent({ onNotificationMessageAdded });

        const params = {
            taskId: 'task-1',
            taskType: 'shell',
            status: 'completed',
            summary: 'Build succeeded',
        };
        agent.handleNotification('notificationMessageAdded', params);

        expect(onNotificationMessageAdded).toHaveBeenCalledWith(params);
    });

    it('permissionRequest forwards requestId and context to callback', () => {
        const onPermissionRequest = vi.fn();
        const { agent } = createAgent({ onPermissionRequest });

        const context: Partial<ToolPermissionContext> = {
            toolName: 'bash',
            toolInput: { command: 'rm -rf /' },
        };
        agent.handleNotification('permissionRequest', { requestId: 'req-1', context });

        expect(onPermissionRequest).toHaveBeenCalledWith('req-1', context);
    });

    // ── Callbacks are optional ─────────────────────────────────

    it('does not throw when callback is not provided', () => {
        const { agent } = createAgent(); // no callbacks

        expect(() => {
            agent.handleNotification('messagesChange', { messages: [] });
            agent.handleNotification('loadingChange', { loading: true, latestTotalTokens: 0 });
            agent.handleNotification('permissionRequest', { requestId: 'r1', context: {} });
        }).not.toThrow();
    });
});
