import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { StdioClient } from '../../src/stdio/stdioClient';
import { NotificationRouter } from '../../src/stdio/notificationRouter';

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

interface FakeAgent {
    handleNotification: ReturnType<typeof vi.fn>;
}

function createFakeAgent(): FakeAgent {
    return { handleNotification: vi.fn() };
}

// Look up the handler the router registered on the client for a method.
function getHandler(client: MockClient, method: string): (params: unknown, sessionId?: string) => void {
    for (const call of client.onNotification.mock.calls) {
        const [m, h] = call as [string, (params: unknown, sessionId?: string) => void];
        if (m === method) return h;
    }
    throw new Error(`No handler registered for method: ${method}`);
}

describe('NotificationRouter', () => {
    let client: MockClient;

    beforeEach(() => {
        vi.clearAllMocks();
        client = createMockClient();
    });

    // ── attach ─────────────────────────────────────────────────

    it('attach subscribes to all notification methods on the client', () => {
        const router = new NotificationRouter(client as unknown as StdioClient);
        router.attach();

        const methods = client.onNotification.mock.calls.map((c) => c[0] as string);
        expect(methods).toContain('messagesChange');
        expect(methods).toContain('userMessageAdded');
        expect(methods).toContain('assistantMessageAdded');
        expect(methods).toContain('assistantContentUpdated');
        expect(methods).toContain('assistantReasoningUpdated');
        expect(methods).toContain('toolBlockUpdated');
        expect(methods).toContain('errorBlockAdded');
        expect(methods).toContain('loadingChange');
        expect(methods).toContain('commandRunningChange');
        expect(methods).toContain('queuedMessagesChange');
        expect(methods).toContain('tasksChange');
        expect(methods).toContain('sessionIdChange');
        expect(methods).toContain('permissionModeChange');
        expect(methods).toContain('mcpServersChange');
        expect(methods).toContain('bangMessageAdded');
        expect(methods).toContain('bangMessageUpdated');
        expect(methods).toContain('bangMessageCompleted');
        expect(methods).toContain('notificationMessageAdded');
        expect(methods).toContain('permissionRequest');
        expect(methods).toContain('authUrl');
        expect(methods).toContain('compactBlockAdded');
    });

    it('attach is idempotent — does not register handlers twice', () => {
        const router = new NotificationRouter(client as unknown as StdioClient);
        router.attach();
        router.attach();

        expect(client.onNotification.mock.calls.length).toBeGreaterThanOrEqual(20);
        // Each method should appear exactly once
        const methods = client.onNotification.mock.calls.map((c) => c[0] as string);
        const unique = new Set(methods);
        expect(unique.size).toBe(methods.length);
    });

    // ── Session-scoped dispatch ────────────────────────────────

    it('dispatches notification to registered agent by sessionId', () => {
        const router = new NotificationRouter(client as unknown as StdioClient);
        router.attach();

        const agent = createFakeAgent();
        router.register('s1', agent as unknown as Parameters<NotificationRouter['register']>[1]);

        getHandler(client, 'messagesChange')({ messages: [] }, 's1');

        expect(agent.handleNotification).toHaveBeenCalledWith('messagesChange', { messages: [] });
    });

    it('drops notification for unregistered sessionId without throwing', () => {
        const router = new NotificationRouter(client as unknown as StdioClient);
        router.attach();

        const agent = createFakeAgent();
        router.register('s1', agent as unknown as Parameters<NotificationRouter['register']>[1]);

        expect(() => {
            getHandler(client, 'messagesChange')({ messages: [] }, 's2');
        }).not.toThrow();
        expect(agent.handleNotification).not.toHaveBeenCalled();
    });

    it('dispatches to the correct agent when multiple are registered', () => {
        const router = new NotificationRouter(client as unknown as StdioClient);
        router.attach();

        const agent1 = createFakeAgent();
        const agent2 = createFakeAgent();
        router.register('s1', agent1 as unknown as Parameters<NotificationRouter['register']>[1]);
        router.register('s2', agent2 as unknown as Parameters<NotificationRouter['register']>[1]);

        getHandler(client, 'tasksChange')({ tasks: [] }, 's2');

        expect(agent1.handleNotification).not.toHaveBeenCalled();
        expect(agent2.handleNotification).toHaveBeenCalledWith('tasksChange', { tasks: [] });
    });

    // ── Global dispatch ────────────────────────────────────────

    it('dispatches notification without sessionId to global handler', () => {
        const router = new NotificationRouter(client as unknown as StdioClient);
        router.attach();

        const globalHandler = vi.fn();
        router.registerGlobal('authUrl', globalHandler);

        getHandler(client, 'authUrl')({ url: 'https://example.com/auth' }, undefined);

        expect(globalHandler).toHaveBeenCalledWith({ url: 'https://example.com/auth' });
    });

    it('notification with sessionId for a global method goes to the agent (sessionId wins)', () => {
        const router = new NotificationRouter(client as unknown as StdioClient);
        router.attach();

        const globalHandler = vi.fn();
        router.registerGlobal('authUrl', globalHandler);

        const agent = createFakeAgent();
        router.register('s1', agent as unknown as Parameters<NotificationRouter['register']>[1]);

        getHandler(client, 'authUrl')({ url: 'https://example.com/auth' }, 's1');

        expect(agent.handleNotification).toHaveBeenCalledWith('authUrl', { url: 'https://example.com/auth' });
        expect(globalHandler).not.toHaveBeenCalled();
    });

    it('global notification for unregistered global method is dropped silently', () => {
        const router = new NotificationRouter(client as unknown as StdioClient);
        router.attach();

        expect(() => {
            getHandler(client, 'authUrl')({ url: 'x' }, undefined);
        }).not.toThrow();
    });

    // ── unregister ─────────────────────────────────────────────

    it('unregister stops dispatching notifications to that agent', () => {
        const router = new NotificationRouter(client as unknown as StdioClient);
        router.attach();

        const agent = createFakeAgent();
        router.register('s1', agent as unknown as Parameters<NotificationRouter['register']>[1]);

        router.unregister('s1');

        getHandler(client, 'messagesChange')({ messages: [] }, 's1');

        expect(agent.handleNotification).not.toHaveBeenCalled();
    });

    it('unregister of unknown sessionId does not throw', () => {
        const router = new NotificationRouter(client as unknown as StdioClient);
        router.attach();

        expect(() => router.unregister('never-registered')).not.toThrow();
    });

    // ── sessionIdChange rekeying ───────────────────────────────

    it('sessionIdChange rekeys the agent from old to new sessionId', () => {
        const router = new NotificationRouter(client as unknown as StdioClient);
        router.attach();

        const agent = createFakeAgent();
        router.register('old-id', agent as unknown as Parameters<NotificationRouter['register']>[1]);

        // Server emits sessionIdChange notification tagged with the OLD sessionId
        // and params carrying the NEW sessionId.
        getHandler(client, 'sessionIdChange')({ sessionId: 'new-id' }, 'old-id');

        // Agent's handleNotification is invoked for the change notification
        expect(agent.handleNotification).toHaveBeenCalledWith('sessionIdChange', { sessionId: 'new-id' });

        // Subsequent notification tagged with new-id dispatches to the same agent
        getHandler(client, 'messagesChange')({ messages: [] }, 'new-id');
        expect(agent.handleNotification).toHaveBeenCalledWith('messagesChange', { messages: [] });

        // Old sessionId no longer routes to the agent
        getHandler(client, 'loadingChange')({ loading: true }, 'old-id');
        expect(agent.handleNotification).toHaveBeenCalledTimes(2);
    });

    it('sessionIdChange with same sessionId does not rekey', () => {
        const router = new NotificationRouter(client as unknown as StdioClient);
        router.attach();

        const agent = createFakeAgent();
        router.register('same-id', agent as unknown as Parameters<NotificationRouter['register']>[1]);

        getHandler(client, 'sessionIdChange')({ sessionId: 'same-id' }, 'same-id');

        // Still dispatches under same-id
        getHandler(client, 'messagesChange')({ messages: [] }, 'same-id');
        expect(agent.handleNotification).toHaveBeenCalledWith('messagesChange', { messages: [] });
    });
});
