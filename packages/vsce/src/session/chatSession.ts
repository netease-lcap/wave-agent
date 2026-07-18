import * as vscode from 'vscode';
import type { Message, PermissionDecision, ToolPermissionContext, PermissionMode, Task, QueuedMessage, McpServerStatus, ToolBlockUpdateCallbackParams } from 'wave-agent-sdk';
import { ConfigurationData } from '../services/configurationService';
import { StdioClient } from '../stdio/stdioClient';
import { StdioAgent, type StdioAgentCallbacks } from '../stdio/stdioAgent';
import { resolveWaveBinary } from '../stdio/binaryResolver';

export interface ChatSessionCallbacks {
    onMessagesChange: (messages: Message[]) => void;
    onTasksChange: (tasks: Task[]) => void;
    onSessionIdChange: (sessionId: string) => void;
    onStreamingChange: (isStreaming: boolean) => void;
    onQueueChange: (queue: QueuedMessage[]) => void;
    onCommandRunningChange: (running: boolean) => void;
    onPermissionModeChange: (mode: PermissionMode) => void;
    onToolPermissionRequest: (context: ToolPermissionContext) => Promise<PermissionDecision>;
    onError: (error: unknown) => void;
    onMcpServersChange?: (servers: McpServerStatus[]) => void;
    // Incremental update callbacks for streaming optimization
    onAssistantMessageAdded?: (message: Message) => void;
    onStreamingContentUpdate?: (params: { messageId: string; accumulated: string; stage: 'streaming' | 'end' }) => void;
    onStreamingReasoningUpdate?: (params: { messageId: string; accumulated: string; stage: 'streaming' | 'end' }) => void;
    onToolBlockUpdate?: (params: ToolBlockUpdateCallbackParams) => void;
    onErrorBlockAdded?: (error: string) => void;
    // Bang message callbacks
    onBangMessageAdded?: () => void;
    onBangMessageUpdated?: () => void;
}

export class ChatSession {
    public agent: StdioAgent | undefined;
    public messages: Message[] = [];
    public tasks: Task[] = [];
    public sessionId: string | undefined;
    public isStreaming: boolean = false;
    public isCommandRunning: boolean = false;
    public isInitializing: boolean = false;
    public inputContent: string = '';
    public messageQueue: QueuedMessage[] = [];
    public pendingConfirmations: Map<string, {
        resolve: (decision: PermissionDecision) => void;
        toolName: string;
        confirmationType: string;
        toolInput: unknown;
        planContent?: string;
        suggestedPrefix?: string;
        hidePersistentOption?: boolean;
    }> = new Map();

    private updateTimer: NodeJS.Timeout | undefined;
    private pendingUpdate: boolean = false;
    private forceNextUpdateImmediate: boolean = false;

    // Throttled incremental update fields
    private streamingContentUpdateTimer: NodeJS.Timeout | undefined;
    private pendingStreamingContentUpdate: { messageId: string; accumulated: string; stage: 'streaming' | 'end' } | undefined;
    private streamingReasoningUpdateTimer: NodeJS.Timeout | undefined;
    private pendingStreamingReasoningUpdate: { messageId: string; accumulated: string; stage: 'streaming' | 'end' } | undefined;

    constructor(
        public readonly viewType: 'sidebar' | 'tab' | 'window',
        public readonly windowId: string | undefined,
        private callbacks: ChatSessionCallbacks
    ) {}

    public async initialize(config: ConfigurationData, restoreSessionId?: string, clientVersion?: string) {
        if (this.isInitializing) {
            return;
        }

        this.isInitializing = true;
        try {
            console.log(`正在初始化 ${this.viewType} 视图的智能体...`, this.windowId ? `窗口ID: ${this.windowId}` : '');

            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            const workdir = workspaceFolder?.uri.fsPath;

            if (workdir) {
                console.log(`设置智能体工作目录为: ${workdir}`);
            }

            const binaryPath = await resolveWaveBinary();
            const client = new StdioClient(binaryPath, ['--stdio']);

            const agentCallbacks: StdioAgentCallbacks = {
                onMessagesChange: (messages: Message[]) => {
                    this.messages = messages;
                },
                onUserMessageAdded: (message: Message) => {
                    this.callbacks.onAssistantMessageAdded?.(message);
                },
                onAssistantMessageAdded: (message: Message) => {
                    this.callbacks.onAssistantMessageAdded?.(message);
                },
                onAssistantContentUpdated: (params) => {
                    this.throttledStreamingContentUpdate(params.messageId, params.accumulated, params.stage);
                },
                onAssistantReasoningUpdated: (params) => {
                    this.throttledStreamingReasoningUpdate(params.messageId, params.accumulated, params.stage);
                },
                onToolBlockUpdated: (params) => {
                    this.callbacks.onToolBlockUpdate?.(params);
                },
                onErrorBlockAdded: (error: string) => {
                    this.callbacks.onErrorBlockAdded?.(error);
                },
                onTasksChange: (tasks: Task[]) => {
                    this.tasks = tasks;
                    this.callbacks.onTasksChange(tasks);
                },
                onSessionIdChange: (sessionId: string) => {
                    this.sessionId = sessionId;
                    this.callbacks.onSessionIdChange(sessionId);
                },
                onPermissionModeChange: (mode: PermissionMode) => {
                    this.callbacks.onPermissionModeChange(mode);
                },
                onLoadingChange: (loading: boolean) => {
                    this.isStreaming = loading;
                    this.callbacks.onStreamingChange(loading);
                },
                onCommandRunningChange: (running: boolean) => {
                    this.isCommandRunning = running;
                    this.callbacks.onCommandRunningChange(running);
                },
                onQueuedMessagesChange: (messages: QueuedMessage[]) => {
                    this.messageQueue = messages;
                    this.callbacks.onQueueChange(messages);
                },
                onMcpServersChange: (servers: McpServerStatus[]) => {
                    this.callbacks.onMcpServersChange?.(servers);
                },
                onBangMessageAdded: () => {
                    this.callbacks.onBangMessageAdded?.();
                },
                onBangMessageUpdated: () => {
                    this.callbacks.onBangMessageUpdated?.();
                },
                onBangMessageCompleted: () => {
                    this.callbacks.onBangMessageUpdated?.();
                },
                onNotificationMessageAdded: (params) => {
                    if (params.message) {
                        this.callbacks.onAssistantMessageAdded?.(params.message);
                    }
                },
                onPermissionRequest: (requestId, context) => {
                    this.callbacks.onToolPermissionRequest(context).then(decision => {
                        this.agent?.sendPermissionResponse(requestId, decision);
                    });
                },
            };

            this.agent = new StdioAgent(client, agentCallbacks);

            const initParams = {
                workdir,
                restoreSessionId,
                apiKey: config.apiKey || undefined,
                defaultHeaders: this.parseHeaders(config.headers),
                baseURL: config.baseURL || undefined,
                model: config.model,
                fastModel: config.fastModel,
                language: config.language,
                clientVersion,
            };

            try {
                await this.agent.initialize(initParams);
            } catch (createError) {
                // If session not found, retry without restoreSessionId (new session)
                if (createError instanceof Error && createError.message.startsWith('Session not found:')) {
                    console.log(`${this.viewType} 会话文件不存在，以新会话模式重新初始化`);
                    await this.agent.initialize({ ...initParams, restoreSessionId: undefined });
                } else {
                    throw createError;
                }
            }

            // 同步 sessionId 从 agent 到 ChatSession
            // 因为 MessageManager 构造函数中设置 sessionId 不会触发 onSessionIdChange 回调
            if (this.agent && this.agent.sessionId && this.sessionId !== this.agent.sessionId) {
                this.sessionId = this.agent.sessionId;
                this.callbacks.onSessionIdChange(this.sessionId);
            }

            console.log(`${this.viewType} 智能体初始化成功`);

        } catch (error) {
            console.error(`初始化 ${this.viewType} 智能体失败:`, error);
            this.callbacks.onError(error);
        } finally {
            this.isInitializing = false;
        }
    }

    public async sendMessage(text: string, images?: Array<{ data: string; mediaType: string; }>, force: boolean = false) {
        if (!this.agent) {
            throw new Error('智能体未初始化');
        }

        let processedImages: Array<{ path: string; mimeType: string; }> | undefined;
        if (images && images.length > 0) {
            processedImages = images.map(image => ({
                path: image.data,
                mimeType: image.mediaType
            }));
        }

        // Prompt history and force-abort are handled server-side by agentBridge

        if (text.startsWith('!')) {
            await this.agent.bang(text.slice(1));
        } else {
            await this.agent.sendMessage(text, processedImages, force);
        }
    }

    public async deleteQueuedMessage(index: number) {
        if (!this.agent) return;
        await this.agent.removeQueuedMessage(index);
    }

    public async abortMessage() {
        if (this.agent) {
            await this.agent.abortMessage();
        }
    }

    public async clearChat() {
        if (this.agent) {
            this.forceNextUpdateImmediate = true;
            this.inputContent = '';
            await this.agent.clearMessages();
            this.throttledUpdateChatMessages([]);
        }
        await this.clearQueue();
    }

    private async clearQueue() {
        if (this.agent && this.agent.queuedMessages.length > 0) {
            await this.agent.abortMessage();
        } else if (this.messageQueue.length > 0) {
            this.messageQueue = [];
            this.callbacks.onQueueChange(this.messageQueue);
        }
    }

    public async restoreSession(sessionId: string) {
        if (this.agent) {
            this.forceNextUpdateImmediate = true;
            this.inputContent = '';
            await this.agent.restoreSession(sessionId);
            // Push restored messages to webview (notification updates this.messages)
            this.throttledUpdateChatMessages(this.messages);
        }
        await this.clearQueue();
    }

    public async updateConfig(config: ConfigurationData) {
        if (this.agent) {
            const currentSessionId = this.sessionId;
            console.log(`[updateConfig] ${this.viewType} 开始更新配置，sessionId: ${currentSessionId}`);

            // 重置 streaming 状态
            if (this.isStreaming) {
                this.isStreaming = false;
                this.callbacks.onStreamingChange(false);
            }

            // Server-side destroy + recreate with restored session
            await this.agent.updateConfig({
                apiKey: config.apiKey || undefined,
                baseURL: config.baseURL || undefined,
                defaultHeaders: this.parseHeaders(config.headers),
                model: config.model,
                fastModel: config.fastModel,
                language: config.language,
            });
            console.log(`[updateConfig] ${this.viewType} 配置更新完成，sessionId: ${this.sessionId}`);
        } else {
            console.log(`[updateConfig] ${this.viewType} agent 为 undefined，跳过更新`);
        }
        await this.clearQueue();
    }

    private parseHeaders(headersStr?: string): Record<string, string> | undefined {
        if (!headersStr || !headersStr.trim()) {
            return undefined;
        }
        try {
            const headers: Record<string, string> = {};
            const lines = headersStr.split('\n');
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('#')) {
                    continue;
                }
                const colonIndex = trimmed.indexOf(':');
                if (colonIndex === -1) {
                    continue;
                }
                const key = trimmed.slice(0, colonIndex).trim();
                const value = trimmed.slice(colonIndex + 1).trim();
                if (key) {
                    headers[key] = value;
                }
            }
            return Object.keys(headers).length > 0 ? headers : undefined;
        } catch (e) {
            console.error('Failed to parse headers:', e);
            return undefined;
        }
    }

    public async getSlashCommands() {
        if (this.agent) {
            return await this.agent.getSlashCommands();
        }
        return [];
    }

    private immediateUpdateChatMessages() {
        if (this.updateTimer) {
            clearTimeout(this.updateTimer);
            this.updateTimer = undefined;
        }
        this.pendingUpdate = false;
        this.callbacks.onMessagesChange(this.messages);
    }

    private throttledUpdateChatMessages(messages: Message[]) {
        this.messages = messages;

        if (this.forceNextUpdateImmediate) {
            this.forceNextUpdateImmediate = false;
            this.immediateUpdateChatMessages();
            return;
        }

        // leading edge: first call fires immediately
        if (!this.pendingUpdate && !this.updateTimer) {
            this.callbacks.onMessagesChange(this.messages);
            this.pendingUpdate = true;
            // trailing edge: fire the last update after 300ms cooldown
            this.updateTimer = setTimeout(() => {
                this.callbacks.onMessagesChange(this.messages);
                this.pendingUpdate = false;
                this.updateTimer = undefined;
            }, 300);
        }
    }

    private throttledStreamingContentUpdate(messageId: string, accumulated: string, stage: 'streaming' | 'end') {
        // If stage is 'end', fire immediately to ensure finalization is not delayed
        if (stage === 'end') {
            if (this.streamingContentUpdateTimer) {
                clearTimeout(this.streamingContentUpdateTimer);
                this.streamingContentUpdateTimer = undefined;
            }
            this.pendingStreamingContentUpdate = undefined;
            this.callbacks.onStreamingContentUpdate?.({ messageId, accumulated, stage });
            return;
        }

        this.pendingStreamingContentUpdate = { messageId, accumulated, stage };

        // leading edge: first call fires immediately
        if (!this.streamingContentUpdateTimer) {
            this.callbacks.onStreamingContentUpdate?.(this.pendingStreamingContentUpdate);
            // trailing edge: fire the last update after 16ms cooldown (~60fps)
            this.streamingContentUpdateTimer = setTimeout(() => {
                if (this.pendingStreamingContentUpdate) {
                    this.callbacks.onStreamingContentUpdate?.(this.pendingStreamingContentUpdate);
                    this.pendingStreamingContentUpdate = undefined;
                }
                this.streamingContentUpdateTimer = undefined;
            }, 16);
        }
    }

    private throttledStreamingReasoningUpdate(messageId: string, accumulated: string, stage: 'streaming' | 'end') {
        // If stage is 'end', fire immediately to ensure finalization is not delayed
        if (stage === 'end') {
            if (this.streamingReasoningUpdateTimer) {
                clearTimeout(this.streamingReasoningUpdateTimer);
                this.streamingReasoningUpdateTimer = undefined;
            }
            this.pendingStreamingReasoningUpdate = undefined;
            this.callbacks.onStreamingReasoningUpdate?.({ messageId, accumulated, stage });
            return;
        }

        this.pendingStreamingReasoningUpdate = { messageId, accumulated, stage };

        // leading edge: first call fires immediately
        if (!this.streamingReasoningUpdateTimer) {
            this.callbacks.onStreamingReasoningUpdate?.(this.pendingStreamingReasoningUpdate);
            // trailing edge: fire the last update after 16ms cooldown (~60fps)
            this.streamingReasoningUpdateTimer = setTimeout(() => {
                if (this.pendingStreamingReasoningUpdate) {
                    this.callbacks.onStreamingReasoningUpdate?.(this.pendingStreamingReasoningUpdate);
                    this.pendingStreamingReasoningUpdate = undefined;
                }
                this.streamingReasoningUpdateTimer = undefined;
            }, 16);
        }
    }

    public async setPermissionMode(mode: PermissionMode) {
        if (this.agent) {
            await this.agent.setPermissionMode(mode);
        }
    }

    public async rewindToMessage(messageId: string) {
        if (!this.agent) {
            throw new Error('智能体未初始化');
        }

        const { inputContent } = await this.agent.rewindToMessage(messageId);
        this.inputContent = inputContent;

        // Messages updated via messagesChange notification; force immediate push
        this.forceNextUpdateImmediate = true;
        this.throttledUpdateChatMessages(this.messages);
    }

    public async destroy() {
        if (this.updateTimer) {
            clearTimeout(this.updateTimer);
            this.updateTimer = undefined;
        }
        if (this.streamingContentUpdateTimer) {
            clearTimeout(this.streamingContentUpdateTimer);
            this.streamingContentUpdateTimer = undefined;
        }
        if (this.streamingReasoningUpdateTimer) {
            clearTimeout(this.streamingReasoningUpdateTimer);
            this.streamingReasoningUpdateTimer = undefined;
        }

        if (this.agent) {
            try {
                await this.agent.destroy();
            } catch (error) {
                console.error(`销毁 ${this.viewType} agent 时出错:`, error);
            }
            this.agent = undefined;
        }

        this.messages = [];
        this.tasks = [];
        this.inputContent = '';
        this.sessionId = undefined;
        this.pendingConfirmations.clear();
        this.isStreaming = false;
        this.isCommandRunning = false;
        this.pendingUpdate = false;
        this.pendingStreamingContentUpdate = undefined;
        this.pendingStreamingReasoningUpdate = undefined;
        this.messageQueue = [];
    }

    // MCP server management
    public async getMcpServers(): Promise<McpServerStatus[]> {
        if (!this.agent) {
            return [];
        }
        return await this.agent.getMcpServers();
    }

    public async connectMcpServer(serverName: string): Promise<boolean> {
        if (!this.agent) {
            return false;
        }
        return this.agent.connectMcpServer(serverName);
    }

    public async disconnectMcpServer(serverName: string): Promise<boolean> {
        if (!this.agent) {
            return false;
        }
        return this.agent.disconnectMcpServer(serverName);
    }
}
