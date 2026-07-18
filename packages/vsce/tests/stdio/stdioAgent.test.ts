import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { StdioClient } from '../../src/stdio/stdioClient';
import { StdioAgent } from '../../src/stdio/stdioAgent';
import type { Message, Task, QueuedMessage, PermissionMode, ToolPermissionContext } from 'wave-agent-sdk';

/** Await a promise that is expected to reject, returning the error. */
async function expectReject(p: Promise<unknown>): Promise<Error> {
    try {
        await p;
        throw new Error('Expected promise to reject');
    } catch (e) {
        return e as Error;
    }
}

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

// Collect notification handlers registered by StdioAgent
function getNotificationHandlers(client: MockClient): Map<string, (params: unknown) => void> {
    const handlers = new Map<string, (params: unknown) => void>();
    for (const call of client.onNotification.mock.calls) {
        const [method, handler] = call as [string, (params: unknown) => void];
        handlers.set(method, handler);
    }
    return handlers;
}

function createAgent(callbacks: Record<string, (...args: unknown[]) => void> = {}) {
    const client = createMockClient();
    const agent = new StdioAgent(
        client as unknown as StdioClient,
        callbacks,
    );
    return { agent, client, handlers: getNotificationHandlers(client) };
}

describe('StdioAgent', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // ── Construction ───────────────────────────────────────────

    it('registers notification handlers for all notification types', () => {
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
    });

    // ── initialize ─────────────────────────────────────────────

    it('sends initialize request and caches returned state', async () => {
        const { agent, client } = createAgent();

        client.request.mockResolvedValue({
            sessionId: 'session-123',
            workingDirectory: '/workspace',
            permissionMode: 'default',
            latestTotalTokens: 500,
        });

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
    });

    // ── destroy ────────────────────────────────────────────────

    it('sends destroy request and disposes client', async () => {
        const { agent, client } = createAgent();
        client.request.mockResolvedValue(undefined);

        await agent.destroy();

        expect(client.request).toHaveBeenCalledWith('destroy');
        expect(client.dispose).toHaveBeenCalled();
    });

    it('disposes client even if destroy request fails', async () => {
        const { agent, client } = createAgent();
        client.request.mockRejectedValue(new Error('destroy failed'));

        const error = await expectReject(agent.destroy());
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toBe('destroy failed');
        expect(client.dispose).toHaveBeenCalled();
    });

    // ── sendMessage ────────────────────────────────────────────

    it('sends sendMessage with text, images, and force', async () => {
        const { agent, client } = createAgent();
        client.request.mockResolvedValue(undefined);

        const images = [{ path: '/img.png', mimeType: 'image/png' }];
        await agent.sendMessage('hello', images, true);

        expect(client.request).toHaveBeenCalledWith('sendMessage', {
            text: 'hello',
            images,
            force: true,
        });
    });

    it('sends sendMessage with minimal args', async () => {
        const { agent, client } = createAgent();
        client.request.mockResolvedValue(undefined);

        await agent.sendMessage('hello');

        expect(client.request).toHaveBeenCalledWith('sendMessage', {
            text: 'hello',
            images: undefined,
            force: undefined,
        });
    });

    // ── bang ───────────────────────────────────────────────────

    it('sends bang request', async () => {
        const { agent, client } = createAgent();
        client.request.mockResolvedValue(undefined);

        await agent.bang('git status');

        expect(client.request).toHaveBeenCalledWith('bang', { command: 'git status' });
    });

    // ── abortMessage ───────────────────────────────────────────

    it('sends abortMessage request', async () => {
        const { agent, client } = createAgent();
        client.request.mockResolvedValue(undefined);

        await agent.abortMessage();

        expect(client.request).toHaveBeenCalledWith('abortMessage');
    });

    // ── clearMessages ──────────────────────────────────────────

    it('sends clearMessages request', async () => {
        const { agent, client } = createAgent();
        client.request.mockResolvedValue(undefined);

        await agent.clearMessages();

        expect(client.request).toHaveBeenCalledWith('clearMessages');
    });

    // ── rewindToMessage ────────────────────────────────────────

    it('sends rewindToMessage and returns inputContent', async () => {
        const { agent, client } = createAgent();
        client.request.mockResolvedValue({ inputContent: 'previous text' });

        const result = await agent.rewindToMessage('msg-1');

        expect(client.request).toHaveBeenCalledWith('rewindToMessage', { messageId: 'msg-1' });
        expect(result).toEqual({ inputContent: 'previous text' });
    });

    // ── removeQueuedMessage ────────────────────────────────────

    it('sends deleteQueuedMessage with index', async () => {
        const { agent, client } = createAgent();
        client.request.mockResolvedValue(undefined);

        await agent.removeQueuedMessage(2);

        expect(client.request).toHaveBeenCalledWith('deleteQueuedMessage', { index: 2 });
    });

    // ── getFullMessageThread ───────────────────────────────────

    it('returns messages and sessionIds', async () => {
        const { agent, client } = createAgent();
        client.request.mockResolvedValue({
            messages: [{ id: 'm1' }],
            sessionIds: ['s1', 's2'],
        });

        const result = await agent.getFullMessageThread();

        expect(result).toEqual({
            messages: [{ id: 'm1' }],
            sessionIds: ['s1', 's2'],
        });
    });

    // ── updateConfig ───────────────────────────────────────────

    it('sends updateConfig and returns new sessionId', async () => {
        const { agent, client } = createAgent();
        client.request.mockResolvedValue({ sessionId: 'new-session' });

        const result = await agent.updateConfig({ model: 'gpt-4' });

        expect(client.request).toHaveBeenCalledWith('updateConfig', { model: 'gpt-4' });
        expect(result).toEqual({ sessionId: 'new-session' });
    });

    // ── restoreSession ─────────────────────────────────────────

    it('sends restoreSession request', async () => {
        const { agent, client } = createAgent();
        client.request.mockResolvedValue(undefined);

        await agent.restoreSession('old-session-id');

        expect(client.request).toHaveBeenCalledWith('restoreSession', { sessionId: 'old-session-id' });
    });

    // ── setPermissionMode ──────────────────────────────────────

    it('sends setPermissionMode request', async () => {
        const { agent, client } = createAgent();
        client.request.mockResolvedValue(undefined);

        await agent.setPermissionMode('plan' as PermissionMode);

        expect(client.request).toHaveBeenCalledWith('setPermissionMode', { mode: 'plan' });
    });

    it('getPermissionMode returns cached value', async () => {
        const { agent } = createAgent();

        expect(agent.getPermissionMode()).toBeUndefined();

        // Simulate notification changing the mode
        (agent as unknown as { permissionMode: PermissionMode }).permissionMode = 'bypassPermissions';
        expect(agent.getPermissionMode()).toBe('bypassPermissions');
    });

    // ── sendPermissionResponse ─────────────────────────────────

    it('sends permissionResponse as notification (not request)', () => {
        const { agent, client } = createAgent();

        agent.sendPermissionResponse('req-1', 'allow' as never);

        expect(client.notify).toHaveBeenCalledWith('permissionResponse', {
            requestId: 'req-1',
            decision: 'allow',
        });
        expect(client.request).not.toHaveBeenCalled();
    });

    // ── MCP ────────────────────────────────────────────────────

    it('getMcpServers unwraps servers from result', async () => {
        const { agent, client } = createAgent();
        const servers = [{ name: 'server1', status: 'connected' }];
        client.request.mockResolvedValue({ servers });

        const result = await agent.getMcpServers();

        expect(result).toEqual(servers);
    });

    it('connectMcpServer returns success boolean', async () => {
        const { agent, client } = createAgent();
        client.request.mockResolvedValue({ success: true });

        const result = await agent.connectMcpServer('my-server');

        expect(client.request).toHaveBeenCalledWith('connectMcpServer', { serverName: 'my-server' });
        expect(result).toBe(true);
    });

    it('disconnectMcpServer returns success boolean', async () => {
        const { agent, client } = createAgent();
        client.request.mockResolvedValue({ success: false });

        const result = await agent.disconnectMcpServer('my-server');

        expect(client.request).toHaveBeenCalledWith('disconnectMcpServer', { serverName: 'my-server' });
        expect(result).toBe(false);
    });

    // ── getSlashCommands ───────────────────────────────────────

    it('unwraps commands from result', async () => {
        const { agent, client } = createAgent();
        const commands = [{ name: 'compact', description: 'Compact' }];
        client.request.mockResolvedValue({ commands });

        const result = await agent.getSlashCommands();

        expect(result).toEqual(commands);
    });

    // ── Notification forwarding ────────────────────────────────

    it('messagesChange updates cached messages and calls callback', () => {
        const onMessagesChange = vi.fn();
        const { agent, handlers } = createAgent({ onMessagesChange });

        const messages: Message[] = [
            { id: 'm1', role: 'user', timestamp: '', blocks: [] },
        ];
        handlers.get('messagesChange')!({ messages });

        expect(agent.messages).toEqual(messages);
        expect(onMessagesChange).toHaveBeenCalledWith(messages);
    });

    it('userMessageAdded forwards message to callback', () => {
        const onUserMessageAdded = vi.fn();
        const { handlers } = createAgent({ onUserMessageAdded });

        const message: Message = { id: 'm1', role: 'user', timestamp: '', blocks: [] };
        handlers.get('userMessageAdded')!({ message });

        expect(onUserMessageAdded).toHaveBeenCalledWith(message);
    });

    it('userMessageAdded does not call callback when message is undefined', () => {
        const onUserMessageAdded = vi.fn();
        const { handlers } = createAgent({ onUserMessageAdded });

        handlers.get('userMessageAdded')!({ message: undefined });

        expect(onUserMessageAdded).not.toHaveBeenCalled();
    });

    it('assistantMessageAdded forwards message to callback', () => {
        const onAssistantMessageAdded = vi.fn();
        const { handlers } = createAgent({ onAssistantMessageAdded });

        const message: Message = { id: 'a1', role: 'assistant', timestamp: '', blocks: [] };
        handlers.get('assistantMessageAdded')!({ message });

        expect(onAssistantMessageAdded).toHaveBeenCalledWith(message);
    });

    it('assistantContentUpdated forwards params to callback', () => {
        const onAssistantContentUpdated = vi.fn();
        const { handlers } = createAgent({ onAssistantContentUpdated });

        const params = { messageId: 'a1', accumulated: 'hello', stage: 'streaming' as const };
        handlers.get('assistantContentUpdated')!(params);

        expect(onAssistantContentUpdated).toHaveBeenCalledWith(params);
    });

    it('assistantReasoningUpdated forwards params to callback', () => {
        const onAssistantReasoningUpdated = vi.fn();
        const { handlers } = createAgent({ onAssistantReasoningUpdated });

        const params = { messageId: 'a1', accumulated: 'thinking', stage: 'end' as const };
        handlers.get('assistantReasoningUpdated')!(params);

        expect(onAssistantReasoningUpdated).toHaveBeenCalledWith(params);
    });

    it('toolBlockUpdated forwards params to callback', () => {
        const onToolBlockUpdated = vi.fn();
        const { handlers } = createAgent({ onToolBlockUpdated });

        const params = { toolName: 'bash', toolCallId: 'tc1', status: 'running' };
        handlers.get('toolBlockUpdated')!(params);

        expect(onToolBlockUpdated).toHaveBeenCalledWith(params);
    });

    it('errorBlockAdded forwards error string to callback', () => {
        const onErrorBlockAdded = vi.fn();
        const { handlers } = createAgent({ onErrorBlockAdded });

        handlers.get('errorBlockAdded')!({ error: 'Something went wrong' });

        expect(onErrorBlockAdded).toHaveBeenCalledWith('Something went wrong');
    });

    it('loadingChange updates latestTotalTokens and calls callback', () => {
        const onLoadingChange = vi.fn();
        const { agent, handlers } = createAgent({ onLoadingChange });

        handlers.get('loadingChange')!({ loading: true, latestTotalTokens: 1000 });

        expect(agent.latestTotalTokens).toBe(1000);
        expect(onLoadingChange).toHaveBeenCalledWith(true);
    });

    it('loadingChange does not update latestTotalTokens when undefined', () => {
        const onLoadingChange = vi.fn();
        const { agent, handlers } = createAgent({ onLoadingChange });

        agent.latestTotalTokens = 500;
        handlers.get('loadingChange')!({ loading: false });

        expect(agent.latestTotalTokens).toBe(500);
        expect(onLoadingChange).toHaveBeenCalledWith(false);
    });

    it('commandRunningChange forwards running boolean', () => {
        const onCommandRunningChange = vi.fn();
        const { handlers } = createAgent({ onCommandRunningChange });

        handlers.get('commandRunningChange')!({ running: true });

        expect(onCommandRunningChange).toHaveBeenCalledWith(true);
    });

    it('queuedMessagesChange updates cached queue and calls callback', () => {
        const onQueuedMessagesChange = vi.fn();
        const { agent, handlers } = createAgent({ onQueuedMessagesChange });

        const queue: QueuedMessage[] = [{ content: 'queued msg' }];
        handlers.get('queuedMessagesChange')!({ messages: queue });

        expect(agent.queuedMessages).toEqual(queue);
        expect(onQueuedMessagesChange).toHaveBeenCalledWith(queue);
    });

    it('tasksChange updates cached tasks and calls callback', () => {
        const onTasksChange = vi.fn();
        const { agent, handlers } = createAgent({ onTasksChange });

        const tasks: Task[] = [{ id: 't1', subject: 'Task 1', description: 'desc', status: 'pending', blocks: [], blockedBy: [], metadata: {} }];
        handlers.get('tasksChange')!({ tasks });

        expect(agent.tasks).toEqual(tasks);
        expect(onTasksChange).toHaveBeenCalledWith(tasks);
    });

    it('sessionIdChange updates cached sessionId and calls callback', () => {
        const onSessionIdChange = vi.fn();
        const { agent, handlers } = createAgent({ onSessionIdChange });

        handlers.get('sessionIdChange')!({ sessionId: 'new-session' });

        expect(agent.sessionId).toBe('new-session');
        expect(onSessionIdChange).toHaveBeenCalledWith('new-session');
    });

    it('permissionModeChange updates cached mode and calls callback', () => {
        const onPermissionModeChange = vi.fn();
        const { agent, handlers } = createAgent({ onPermissionModeChange });

        handlers.get('permissionModeChange')!({ mode: 'plan' });

        expect(agent.permissionMode).toBe('plan');
        expect(onPermissionModeChange).toHaveBeenCalledWith('plan');
    });

    it('mcpServersChange forwards servers to callback', () => {
        const onMcpServersChange = vi.fn();
        const { handlers } = createAgent({ onMcpServersChange });

        const servers = [{ name: 's1', status: 'connected' }];
        handlers.get('mcpServersChange')!({ servers });

        expect(onMcpServersChange).toHaveBeenCalledWith(servers);
    });

    it('bangMessageAdded/Updated/Completed call respective callbacks', () => {
        const onBangMessageAdded = vi.fn();
        const onBangMessageUpdated = vi.fn();
        const onBangMessageCompleted = vi.fn();
        const { handlers } = createAgent({
            onBangMessageAdded,
            onBangMessageUpdated,
            onBangMessageCompleted,
        });

        handlers.get('bangMessageAdded')!(undefined);
        handlers.get('bangMessageUpdated')!(undefined);
        handlers.get('bangMessageCompleted')!(undefined);

        expect(onBangMessageAdded).toHaveBeenCalled();
        expect(onBangMessageUpdated).toHaveBeenCalled();
        expect(onBangMessageCompleted).toHaveBeenCalled();
    });

    it('notificationMessageAdded forwards params to callback', () => {
        const onNotificationMessageAdded = vi.fn();
        const { handlers } = createAgent({ onNotificationMessageAdded });

        const params = {
            taskId: 'task-1',
            taskType: 'shell',
            status: 'completed',
            summary: 'Build succeeded',
        };
        handlers.get('notificationMessageAdded')!(params);

        expect(onNotificationMessageAdded).toHaveBeenCalledWith(params);
    });

    it('permissionRequest forwards requestId and context to callback', () => {
        const onPermissionRequest = vi.fn();
        const { handlers } = createAgent({ onPermissionRequest });

        const context: Partial<ToolPermissionContext> = {
            toolName: 'bash',
            toolInput: { command: 'rm -rf /' },
        };
        handlers.get('permissionRequest')!({ requestId: 'req-1', context });

        expect(onPermissionRequest).toHaveBeenCalledWith('req-1', context);
    });

    // ── Callbacks are optional ─────────────────────────────────

    it('does not throw when callback is not provided', () => {
        const { handlers } = createAgent(); // no callbacks

        expect(() => {
            handlers.get('messagesChange')!({ messages: [] });
            handlers.get('loadingChange')!({ loading: true, latestTotalTokens: 0 });
            handlers.get('permissionRequest')!({ requestId: 'r1', context: {} });
        }).not.toThrow();
    });
});
