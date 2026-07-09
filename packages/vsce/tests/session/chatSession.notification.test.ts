import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock VscodeLspAdapter - must be a constructor (not arrow function)
vi.mock('../../src/services/lspAdapter', () => ({
    VscodeLspAdapter: vi.fn(function() { return {}; }),
}));

// Mock wave-agent-sdk: Agent.create captures callbacks, PromptHistoryManager is noop
const { capturedCallbacks, setCapturedCallbacks } = vi.hoisted(() => {
    let capturedCallbacks: Record<string, (...args: unknown[]) => void> | undefined;
    return {
        capturedCallbacks: () => capturedCallbacks,
        setCapturedCallbacks: (cb: Record<string, (...args: unknown[]) => void>) => { capturedCallbacks = cb; },
    };
});

vi.mock('wave-agent-sdk', () => {
    return {
        Agent: {
            create: async (options: { callbacks: Record<string, (...args: unknown[]) => void> }) => {
                setCapturedCallbacks(options.callbacks);
                const messages: Message[] = [];
                return {
                    sessionId: 'test-session-1',
                    get messages() { return messages; },
                    _setMessages(arr: Message[]) { messages.splice(0, messages.length, ...arr); },
                };
            },
        },
        PromptHistoryManager: {
            addEntry: () => {},
        },
    };
});

import { ChatSession } from '../../src/session/chatSession';
import type { Message } from 'wave-agent-sdk';

function createMockCallbacks() {
    return {
        onMessagesChange: vi.fn(),
        onTasksChange: vi.fn(),
        onSessionIdChange: vi.fn(),
        onStreamingChange: vi.fn(),
        onQueueChange: vi.fn(),
        onCommandRunningChange: vi.fn(),
        onPermissionModeChange: vi.fn(),
        onToolPermissionRequest: vi.fn(),
        onError: vi.fn(),
        onAssistantMessageAdded: vi.fn(),
    };
}

async function createInitializedSession() {
    const callbacks = createMockCallbacks();
    const session = new ChatSession('sidebar', undefined, callbacks);
    await session.initialize({} as never, 2 satisfies number);

    if (!session.agent) {
        throw new Error('Agent init failed');
    }
    return { session, callbacks };
}

describe('ChatSession onNotificationMessageAdded callback', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should forward notification message via onAssistantMessageAdded (incremental)', async () => {
        const { session, callbacks } = await createInitializedSession();

        const notificationMessage: Message = {
            id: 'msg_notif_1',
            role: 'user',
            timestamp: '2025-01-01T00:00:00.000Z',
            blocks: [{
                type: 'task_notification',
                taskId: 'task-001',
                taskType: 'shell',
                status: 'completed',
                summary: 'Build succeeded',
            }],
        };
        (session.agent as unknown as { _setMessages: (arr: Message[]) => void })._setMessages([notificationMessage]);

        capturedCallbacks()!.onNotificationMessageAdded({
            taskId: 'task-001',
            taskType: 'shell',
            status: 'completed',
            summary: 'Build succeeded',
        });

        expect(callbacks.onAssistantMessageAdded).toHaveBeenCalledWith(notificationMessage);
        // Should NOT trigger full message list update
        expect(callbacks.onMessagesChange).not.toHaveBeenCalled();
    });

    it('should find the correct notification among multiple messages', async () => {
        const { session, callbacks } = await createInitializedSession();

        const otherMessage: Message = {
            id: 'msg_other',
            role: 'user',
            timestamp: '2025-01-01T00:00:00.000Z',
            blocks: [{ type: 'text', content: 'hello' }],
        };
        const targetNotification: Message = {
            id: 'msg_notif_target',
            role: 'user',
            timestamp: '2025-01-01T00:00:01.000Z',
            blocks: [{
                type: 'task_notification',
                taskId: 'task-target',
                taskType: 'agent',
                status: 'failed',
                summary: 'Agent timed out',
            }],
        };
        (session.agent as unknown as { _setMessages: (arr: Message[]) => void })._setMessages([otherMessage, targetNotification]);

        capturedCallbacks()!.onNotificationMessageAdded({
            taskId: 'task-target',
            taskType: 'agent',
            status: 'failed',
            summary: 'Agent timed out',
        });

        expect(callbacks.onAssistantMessageAdded).toHaveBeenCalledWith(targetNotification);
        expect(callbacks.onAssistantMessageAdded).not.toHaveBeenCalledWith(otherMessage);
    });

    it('should not call onAssistantMessageAdded when no matching message found', async () => {
        const { session, callbacks } = await createInitializedSession();

        (session.agent as unknown as { _setMessages: (arr: Message[]) => void })._setMessages([]);

        capturedCallbacks()!.onNotificationMessageAdded({
            taskId: 'nonexistent',
            taskType: 'shell',
            status: 'completed',
            summary: 'Nothing',
        });

        expect(callbacks.onAssistantMessageAdded).not.toHaveBeenCalled();
    });

    it('should not call onAssistantMessageAdded when agent is undefined', async () => {
        const { session, callbacks } = await createInitializedSession();

        session.agent = undefined;

        expect(() => {
            capturedCallbacks()!.onNotificationMessageAdded({
                taskId: 'task-001',
                taskType: 'shell',
                status: 'completed',
                summary: 'Build succeeded',
            });
        }).not.toThrow();

        expect(callbacks.onAssistantMessageAdded).not.toHaveBeenCalled();
    });
});
