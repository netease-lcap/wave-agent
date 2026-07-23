/**
 * NotificationRouter — demultiplexes server→client notifications by sessionId.
 *
 * In the single-shared-process architecture, all sessions share one StdioClient.
 * The server tags each session-scoped notification with `sessionId` on the
 * JSON-RPC envelope. The router inspects that field and dispatches to the
 * matching StdioAgent; notifications without sessionId (e.g. `authUrl`) go to
 * a global handler.
 *
 * Lifecycle:
 * 1. `attach()` once — subscribes to every notification method on the shared client
 * 2. Per session: `register(sessionId, agent)` after `initialize` response
 * 3. On `sessionIdChange`: router auto-rekeys the agent (old → new)
 * 4. On `destroy`: `unregister(sessionId)` removes the agent
 */

import type { StdioClient } from './stdioClient';

type GlobalHandler = (params: unknown) => void;

// StdioAgent is imported lazily via a type-only import to avoid a circular
// dependency at runtime (StdioAgent imports NotificationRouter for its type).
import type { StdioAgent } from './stdioAgent';

const ALL_NOTIFICATION_METHODS = [
    'messagesChange',
    'userMessageAdded',
    'assistantMessageAdded',
    'assistantContentUpdated',
    'assistantReasoningUpdated',
    'toolBlockUpdated',
    'errorBlockAdded',
    'loadingChange',
    'commandRunningChange',
    'queuedMessagesChange',
    'tasksChange',
    'sessionIdChange',
    'permissionModeChange',
    'mcpServersChange',
    'workdirChange',
    'bangMessageAdded',
    'bangMessageUpdated',
    'bangMessageCompleted',
    'notificationMessageAdded',
    'permissionRequest',
    'authUrl',
    'compactBlockAdded',
] as const;

export class NotificationRouter {
    private sessions = new Map<string, StdioAgent>();
    private globalHandlers = new Map<string, GlobalHandler>();
    private attached = false;

    constructor(private client: StdioClient) {}

    /**
     * Subscribe to all notification methods on the shared StdioClient.
     * Must be called once after construction. Idempotent.
     */
    attach(): void {
        if (this.attached) return;
        this.attached = true;
        for (const method of ALL_NOTIFICATION_METHODS) {
            this.client.onNotification(method, (params, sessionId) => {
                this.dispatch(method, params, sessionId);
            });
        }
    }

    /** Register a session-scoped agent. Call after `initialize` response. */
    register(sessionId: string, agent: StdioAgent): void {
        this.sessions.set(sessionId, agent);
    }

    /** Unregister a session. Call on destroy. */
    unregister(sessionId: string): void {
        this.sessions.delete(sessionId);
    }

    /** Register a global (non-session-scoped) notification handler. */
    registerGlobal(method: string, handler: GlobalHandler): void {
        this.globalHandlers.set(method, handler);
    }

    private dispatch(
        method: string,
        params: unknown,
        sessionId?: string,
    ): void {
        if (sessionId) {
            const agent = this.sessions.get(sessionId);
            if (!agent) return; // early notification before register — drop (v1)
            // sessionIdChange requires rekeying the agent in the map
            if (method === 'sessionIdChange') {
                const newId = (params as { sessionId: string }).sessionId;
                if (newId && newId !== sessionId) {
                    this.sessions.delete(sessionId);
                    this.sessions.set(newId, agent);
                }
            }
            agent.handleNotification(method, params);
        } else {
            // Global notification (e.g. authUrl)
            const handler = this.globalHandlers.get(method);
            if (handler) handler(params);
        }
    }
}
