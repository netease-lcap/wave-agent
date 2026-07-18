/**
 * StdioAgent — typed wrapper around StdioClient that mirrors the Agent API.
 *
 * Replaces direct `Agent` usage in ChatSession. All previously-synchronous
 * methods (abortMessage, clearMessages, getSlashCommands, etc.) are now async
 * because they cross a subprocess boundary.
 *
 * Cached state (sessionId, workingDirectory, latestTotalTokens, permissionMode,
 * messages, queuedMessages, tasks) is kept in sync via notifications, allowing
 * synchronous property access where the old code used `agent.xxx`.
 */

import type {
    Message,
    Task,
    QueuedMessage,
    McpServerStatus,
    PermissionMode,
    PermissionDecision,
    ToolPermissionContext,
    ToolBlockUpdateCallbackParams,
    SlashCommand,
    McpServerConfig,
} from 'wave-agent-sdk';
import { StdioClient } from './stdioClient';

// ── Params / Results ─────────────────────────────────────────────

export interface InitializeParams {
    workdir?: string;
    restoreSessionId?: string;
    apiKey?: string;
    baseURL?: string;
    serverUrl?: string;
    defaultHeaders?: Record<string, string>;
    model?: string;
    fastModel?: string;
    language?: string;
    permissionMode?: PermissionMode;
    tools?: string[];
    allowedTools?: string[];
    disallowedTools?: string[];
    pluginDirs?: string[];
    mcpServers?: Record<string, McpServerConfig>;
    clientVersion?: string;
}

export interface InitializeResult {
    sessionId: string;
    workingDirectory: string;
    permissionMode: PermissionMode;
    latestTotalTokens: number;
    serverVersion?: string;
}

export interface UpdateConfigParams {
    apiKey?: string;
    baseURL?: string;
    serverUrl?: string;
    defaultHeaders?: Record<string, string>;
    model?: string;
    fastModel?: string;
    language?: string;
}

// ── Callbacks (mirror AgentCallbacks) ────────────────────────────

export interface StdioAgentCallbacks {
    onMessagesChange?: (messages: Message[]) => void;
    onUserMessageAdded?: (message: Message) => void;
    onAssistantMessageAdded?: (message: Message) => void;
    onAssistantContentUpdated?: (params: {
        messageId: string;
        accumulated: string;
        stage: 'streaming' | 'end';
    }) => void;
    onAssistantReasoningUpdated?: (params: {
        messageId: string;
        accumulated: string;
        stage: 'streaming' | 'end';
    }) => void;
    onToolBlockUpdated?: (params: ToolBlockUpdateCallbackParams) => void;
    onErrorBlockAdded?: (error: string) => void;
    onLoadingChange?: (loading: boolean) => void;
    onCommandRunningChange?: (running: boolean) => void;
    onQueuedMessagesChange?: (messages: QueuedMessage[]) => void;
    onTasksChange?: (tasks: Task[]) => void;
    onSessionIdChange?: (sessionId: string) => void;
    onPermissionModeChange?: (mode: PermissionMode) => void;
    onMcpServersChange?: (servers: McpServerStatus[]) => void;
    onBangMessageAdded?: () => void;
    onBangMessageUpdated?: () => void;
    onBangMessageCompleted?: () => void;
    onNotificationMessageAdded?: (params: {
        taskId: string;
        taskType: string;
        status: string;
        summary: string;
        message?: Message;
    }) => void;
    onPermissionRequest?: (
        requestId: string,
        context: ToolPermissionContext,
    ) => void;
}

// ── StdioAgent ───────────────────────────────────────────────────

export class StdioAgent {
    // ── Cached state (synchronous access) ──
    public sessionId: string | undefined;
    public workingDirectory: string | undefined;
    public latestTotalTokens = 0;
    public permissionMode: PermissionMode | undefined;
    public serverVersion: string | undefined;
    public messages: Message[] = [];
    public queuedMessages: QueuedMessage[] = [];
    public tasks: Task[] = [];

    private client: StdioClient;
    private callbacks: StdioAgentCallbacks;

    constructor(client: StdioClient, callbacks: StdioAgentCallbacks) {
        this.client = client;
        this.callbacks = callbacks;
        this.registerNotifications();
    }

    // ── Lifecycle ─────────────────────────────────────────────────

    async initialize(
        params: InitializeParams,
    ): Promise<InitializeResult> {
        const result = (await this.client.request(
            'initialize',
            params,
        )) as InitializeResult;
        this.sessionId = result.sessionId;
        this.workingDirectory = result.workingDirectory;
        this.permissionMode = result.permissionMode;
        this.latestTotalTokens = result.latestTotalTokens;
        this.serverVersion = result.serverVersion;
        return result;
    }

    async destroy(): Promise<void> {
        try {
            await this.client.request('destroy');
        } finally {
            this.client.dispose();
        }
    }

    async restoreSession(sessionId: string): Promise<void> {
        await this.client.request('restoreSession', { sessionId });
    }

    async updateConfig(
        params: UpdateConfigParams,
    ): Promise<{ sessionId: string }> {
        return (await this.client.request(
            'updateConfig',
            params,
        )) as { sessionId: string };
    }

    // ── Messages ──────────────────────────────────────────────────

    async sendMessage(
        text: string,
        images?: Array<{ path: string; mimeType: string }>,
        force?: boolean,
    ): Promise<void> {
        await this.client.request('sendMessage', { text, images, force });
    }

    async bang(command: string): Promise<void> {
        await this.client.request('bang', { command });
    }

    async abortMessage(): Promise<void> {
        await this.client.request('abortMessage');
    }

    async clearMessages(): Promise<void> {
        await this.client.request('clearMessages');
    }

    async rewindToMessage(
        messageId: string,
    ): Promise<{ inputContent: string }> {
        return (await this.client.request('rewindToMessage', {
            messageId,
        })) as { inputContent: string };
    }

    async removeQueuedMessage(index: number): Promise<void> {
        await this.client.request('deleteQueuedMessage', { index });
    }

    async getFullMessageThread(): Promise<{
        messages: Message[];
        sessionIds: string[];
    }> {
        return (await this.client.request(
            'getFullMessageThread',
        )) as { messages: Message[]; sessionIds: string[] };
    }

    // ── Permissions ───────────────────────────────────────────────

    async setPermissionMode(mode: PermissionMode): Promise<void> {
        await this.client.request('setPermissionMode', { mode });
    }

    /** Returns cached permission mode (updated via notification). */
    getPermissionMode(): PermissionMode | undefined {
        return this.permissionMode;
    }

    sendPermissionResponse(
        requestId: string,
        decision: PermissionDecision,
    ): void {
        this.client.notify('permissionResponse', { requestId, decision });
    }

    // ── MCP ───────────────────────────────────────────────────────

    async getMcpServers(): Promise<McpServerStatus[]> {
        const result = (await this.client.request('getMcpServers')) as {
            servers: McpServerStatus[];
        };
        return result.servers;
    }

    async connectMcpServer(serverName: string): Promise<boolean> {
        const result = (await this.client.request('connectMcpServer', {
            serverName,
        })) as { success: boolean };
        return result.success;
    }

    async disconnectMcpServer(serverName: string): Promise<boolean> {
        const result = (await this.client.request('disconnectMcpServer', {
            serverName,
        })) as { success: boolean };
        return result.success;
    }

    // ── Commands ──────────────────────────────────────────────────

    async getSlashCommands(): Promise<SlashCommand[]> {
        const result = (await this.client.request('getSlashCommands')) as {
            commands: SlashCommand[];
        };
        return result.commands;
    }

    // ── Notification registration ─────────────────────────────────

    private registerNotifications(): void {
        const on = (method: string, handler: NotificationHandler) => {
            this.client.onNotification(method, handler);
        };

        on('messagesChange', (params) => {
            const p = params as { messages: Message[] };
            this.messages = p.messages;
            this.callbacks.onMessagesChange?.(this.messages);
        });

        on('userMessageAdded', (params) => {
            const p = params as { message: Message };
            if (p.message) this.callbacks.onUserMessageAdded?.(p.message);
        });

        on('assistantMessageAdded', (params) => {
            const p = params as { message: Message };
            if (p.message) this.callbacks.onAssistantMessageAdded?.(p.message);
        });

        on('assistantContentUpdated', (params) => {
            this.callbacks.onAssistantContentUpdated?.(
                params as {
                    messageId: string;
                    accumulated: string;
                    stage: 'streaming' | 'end';
                },
            );
        });

        on('assistantReasoningUpdated', (params) => {
            this.callbacks.onAssistantReasoningUpdated?.(
                params as {
                    messageId: string;
                    accumulated: string;
                    stage: 'streaming' | 'end';
                },
            );
        });

        on('toolBlockUpdated', (params) => {
            this.callbacks.onToolBlockUpdated?.(
                params as ToolBlockUpdateCallbackParams,
            );
        });

        on('errorBlockAdded', (params) => {
            const p = params as { error: string };
            this.callbacks.onErrorBlockAdded?.(p.error);
        });

        on('loadingChange', (params) => {
            const p = params as {
                loading: boolean;
                latestTotalTokens: number;
            };
            if (p.latestTotalTokens !== undefined) {
                this.latestTotalTokens = p.latestTotalTokens;
            }
            this.callbacks.onLoadingChange?.(p.loading);
        });

        on('commandRunningChange', (params) => {
            const p = params as { running: boolean };
            this.callbacks.onCommandRunningChange?.(p.running);
        });

        on('queuedMessagesChange', (params) => {
            const p = params as { messages: QueuedMessage[] };
            this.queuedMessages = p.messages;
            this.callbacks.onQueuedMessagesChange?.(p.messages);
        });

        on('tasksChange', (params) => {
            const p = params as { tasks: Task[] };
            this.tasks = p.tasks;
            this.callbacks.onTasksChange?.(p.tasks);
        });

        on('sessionIdChange', (params) => {
            const p = params as { sessionId: string };
            this.sessionId = p.sessionId;
            this.callbacks.onSessionIdChange?.(p.sessionId);
        });

        on('permissionModeChange', (params) => {
            const p = params as { mode: PermissionMode };
            this.permissionMode = p.mode;
            this.callbacks.onPermissionModeChange?.(p.mode);
        });

        on('mcpServersChange', (params) => {
            const p = params as { servers: McpServerStatus[] };
            this.callbacks.onMcpServersChange?.(p.servers);
        });

        on('bangMessageAdded', () => {
            this.callbacks.onBangMessageAdded?.();
        });

        on('bangMessageUpdated', () => {
            this.callbacks.onBangMessageUpdated?.();
        });

        on('bangMessageCompleted', () => {
            this.callbacks.onBangMessageCompleted?.();
        });

        on('notificationMessageAdded', (params) => {
            this.callbacks.onNotificationMessageAdded?.(
                params as {
                    taskId: string;
                    taskType: string;
                    status: string;
                    summary: string;
                    message?: Message;
                },
            );
        });

        on('permissionRequest', (params) => {
            const p = params as {
                requestId: string;
                context: ToolPermissionContext;
            };
            this.callbacks.onPermissionRequest?.(p.requestId, p.context);
        });
    }
}

type NotificationHandler = (params: unknown) => void;
