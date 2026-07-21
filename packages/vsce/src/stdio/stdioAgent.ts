/**
 * StdioAgent — typed wrapper around StdioClient that mirrors the Agent API.
 *
 * In the single-shared-process architecture, all sessions share one
 * StdioClient. The NotificationRouter dispatches incoming notifications to
 * the appropriate StdioAgent via `handleNotification()`. The agent no longer
 * subscribes directly to the client.
 *
 * All session-scoped requests carry `this.sessionId` on the JSON-RPC envelope
 * so the server can route them to the right Agent.
 *
 * `destroy()` only unregisters from the router and sends the destroy request;
 * it does NOT dispose the shared StdioClient.
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
import { NotificationRouter } from './notificationRouter';

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
    private router: NotificationRouter;
    private callbacks: StdioAgentCallbacks;

    constructor(
        client: StdioClient,
        router: NotificationRouter,
        callbacks: StdioAgentCallbacks,
    ) {
        this.client = client;
        this.router = router;
        this.callbacks = callbacks;
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
        // Register with the router so subsequent notifications are routed here
        this.router.register(this.sessionId, this);
        return result;
    }

    async destroy(): Promise<void> {
        if (this.sessionId) {
            this.router.unregister(this.sessionId);
        }
        try {
            await this.client.request('destroy', undefined, this.sessionId);
        } catch {
            // Process may have already exited; best-effort
        }
        // NOTE: do NOT dispose the shared client — other sessions may still use it
    }

    async restoreSession(sessionId: string): Promise<void> {
        await this.client.request(
            'restoreSession',
            { sessionId },
            this.sessionId,
        );
    }

    async updateConfig(
        params: UpdateConfigParams,
    ): Promise<{ sessionId: string }> {
        const oldSessionId = this.sessionId;
        const result = (await this.client.request(
            'updateConfig',
            params,
            this.sessionId,
        )) as { sessionId: string };
        // If sessionId changed, re-register with the router
        if (oldSessionId && result.sessionId !== oldSessionId) {
            this.router.unregister(oldSessionId);
            this.sessionId = result.sessionId;
            this.router.register(this.sessionId, this);
        }
        return result;
    }

    // ── Messages ──────────────────────────────────────────────────

    async sendMessage(
        text: string,
        images?: Array<{ path: string; mimeType: string }>,
        force?: boolean,
    ): Promise<void> {
        await this.client.request(
            'sendMessage',
            { text, images, force },
            this.sessionId,
        );
    }

    async bang(command: string): Promise<void> {
        await this.client.request('bang', { command }, this.sessionId);
    }

    async abortMessage(): Promise<void> {
        await this.client.request('abortMessage', undefined, this.sessionId);
    }

    async clearMessages(): Promise<void> {
        await this.client.request('clearMessages', undefined, this.sessionId);
    }

    async rewindToMessage(
        messageId: string,
    ): Promise<{ inputContent: string }> {
        return (await this.client.request(
            'rewindToMessage',
            { messageId },
            this.sessionId,
        )) as { inputContent: string };
    }

    async removeQueuedMessage(index: number): Promise<void> {
        await this.client.request(
            'deleteQueuedMessage',
            { index },
            this.sessionId,
        );
    }

    async updateQueuedMessageById(
        id: string,
        patch: {
            content?: string;
            images?: Array<{ path: string; mimeType: string }>;
            type?: 'message' | 'bang';
        },
    ): Promise<boolean> {
        const result = (await this.client.request(
            'updateQueuedMessage',
            { id, text: patch.content, images: patch.images },
            this.sessionId,
        )) as { ok: boolean };
        return result?.ok ?? false;
    }

    async removeQueuedMessageById(id: string): Promise<void> {
        await this.client.request(
            'deleteQueuedMessageById',
            { id },
            this.sessionId,
        );
    }

    async getFullMessageThread(): Promise<{
        messages: Message[];
        sessionIds: string[];
    }> {
        return (await this.client.request(
            'getFullMessageThread',
            undefined,
            this.sessionId,
        )) as { messages: Message[]; sessionIds: string[] };
    }

    // ── Permissions ───────────────────────────────────────────────

    async setPermissionMode(mode: PermissionMode): Promise<void> {
        await this.client.request(
            'setPermissionMode',
            { mode },
            this.sessionId,
        );
    }

    /** Returns cached permission mode (updated via notification). */
    getPermissionMode(): PermissionMode | undefined {
        return this.permissionMode;
    }

    sendPermissionResponse(
        requestId: string,
        decision: PermissionDecision,
    ): void {
        this.client.notify(
            'permissionResponse',
            { requestId, decision },
            this.sessionId,
        );
    }

    // ── MCP ───────────────────────────────────────────────────────

    async getMcpServers(): Promise<McpServerStatus[]> {
        const result = (await this.client.request(
            'getMcpServers',
            undefined,
            this.sessionId,
        )) as { servers: McpServerStatus[] };
        return result.servers;
    }

    async connectMcpServer(serverName: string): Promise<boolean> {
        const result = (await this.client.request(
            'connectMcpServer',
            { serverName },
            this.sessionId,
        )) as { success: boolean };
        return result.success;
    }

    async disconnectMcpServer(serverName: string): Promise<boolean> {
        const result = (await this.client.request(
            'disconnectMcpServer',
            { serverName },
            this.sessionId,
        )) as { success: boolean };
        return result.success;
    }

    // ── Commands ──────────────────────────────────────────────────

    async getSlashCommands(): Promise<SlashCommand[]> {
        const result = (await this.client.request(
            'getSlashCommands',
            undefined,
            this.sessionId,
        )) as { commands: SlashCommand[] };
        return result.commands;
    }

    // ── Notification dispatch (called by NotificationRouter) ──────

    handleNotification(method: string, params: unknown): void {
        switch (method) {
            case 'messagesChange': {
                const p = params as { messages: Message[] };
                this.messages = p.messages;
                this.callbacks.onMessagesChange?.(this.messages);
                break;
            }
            case 'userMessageAdded': {
                const p = params as { message: Message };
                if (p.message) this.callbacks.onUserMessageAdded?.(p.message);
                break;
            }
            case 'assistantMessageAdded': {
                const p = params as { message: Message };
                if (p.message)
                    this.callbacks.onAssistantMessageAdded?.(p.message);
                break;
            }
            case 'assistantContentUpdated':
                this.callbacks.onAssistantContentUpdated?.(
                    params as {
                        messageId: string;
                        accumulated: string;
                        stage: 'streaming' | 'end';
                    },
                );
                break;
            case 'assistantReasoningUpdated':
                this.callbacks.onAssistantReasoningUpdated?.(
                    params as {
                        messageId: string;
                        accumulated: string;
                        stage: 'streaming' | 'end';
                    },
                );
                break;
            case 'toolBlockUpdated':
                this.callbacks.onToolBlockUpdated?.(
                    params as ToolBlockUpdateCallbackParams,
                );
                break;
            case 'errorBlockAdded': {
                const p = params as { error: string };
                this.callbacks.onErrorBlockAdded?.(p.error);
                break;
            }
            case 'loadingChange': {
                const p = params as {
                    loading: boolean;
                    latestTotalTokens: number;
                };
                if (p.latestTotalTokens !== undefined) {
                    this.latestTotalTokens = p.latestTotalTokens;
                }
                this.callbacks.onLoadingChange?.(p.loading);
                break;
            }
            case 'commandRunningChange': {
                const p = params as { running: boolean };
                this.callbacks.onCommandRunningChange?.(p.running);
                break;
            }
            case 'queuedMessagesChange': {
                const p = params as { messages: QueuedMessage[] };
                this.queuedMessages = p.messages;
                this.callbacks.onQueuedMessagesChange?.(p.messages);
                break;
            }
            case 'tasksChange': {
                const p = params as { tasks: Task[] };
                this.tasks = p.tasks;
                this.callbacks.onTasksChange?.(p.tasks);
                break;
            }
            case 'sessionIdChange': {
                const p = params as { sessionId: string };
                this.sessionId = p.sessionId;
                this.callbacks.onSessionIdChange?.(p.sessionId);
                break;
            }
            case 'permissionModeChange': {
                const p = params as { mode: PermissionMode };
                this.permissionMode = p.mode;
                this.callbacks.onPermissionModeChange?.(p.mode);
                break;
            }
            case 'mcpServersChange': {
                const p = params as { servers: McpServerStatus[] };
                this.callbacks.onMcpServersChange?.(p.servers);
                break;
            }
            case 'bangMessageAdded':
                this.callbacks.onBangMessageAdded?.();
                break;
            case 'bangMessageUpdated':
                this.callbacks.onBangMessageUpdated?.();
                break;
            case 'bangMessageCompleted':
                this.callbacks.onBangMessageCompleted?.();
                break;
            case 'notificationMessageAdded':
                this.callbacks.onNotificationMessageAdded?.(
                    params as {
                        taskId: string;
                        taskType: string;
                        status: string;
                        summary: string;
                        message?: Message;
                    },
                );
                break;
            case 'permissionRequest': {
                const p = params as {
                    requestId: string;
                    context: ToolPermissionContext;
                };
                this.callbacks.onPermissionRequest?.(p.requestId, p.context);
                break;
            }
        }
    }
}
