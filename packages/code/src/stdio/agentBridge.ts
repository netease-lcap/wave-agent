/**
 * AgentBridge — wraps the SDK Agent and translates between the JSON-RPC-like
 * stdio protocol and Agent method calls / callbacks.
 *
 * Responsibilities:
 * - Route incoming requests to the appropriate Agent method
 * - Translate AgentCallbacks into outgoing notifications
 * - Implement the canUseTool permission flow over the stdio protocol
 * - Handle config updates by destroying and recreating the Agent
 */

import {
  Agent,
  type AgentCallbacks,
  type AgentOptions,
  type Message,
  type PermissionDecision,
  type PermissionMode,
  type ToolPermissionContext,
  type McpServerStatus,
  type Task,
  type QueuedMessage,
  type SessionMetadata,
  type McpServerConfig,
  listSessions,
  searchFiles,
  PromptHistoryManager,
  type SlashCommand,
} from "wave-agent-sdk";
import {
  type JsonRpcError,
  INTERNAL_ERROR as PROTOCOL_INTERNAL_ERROR,
  METHOD_NOT_FOUND as PROTOCOL_METHOD_NOT_FOUND,
} from "./protocol.js";

export type NotificationEmitter = (method: string, params: unknown) => void;

export interface AgentBridgeOptions {
  emit: NotificationEmitter;
}

interface InitializeParams {
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
}

interface UpdateConfigParams {
  apiKey?: string;
  baseURL?: string;
  serverUrl?: string;
  defaultHeaders?: Record<string, string>;
  model?: string;
  fastModel?: string;
  language?: string;
}

export class AgentBridge {
  private agent: Agent | undefined;
  private pendingPermissions = new Map<
    string,
    (decision: PermissionDecision) => void
  >();
  private permissionCounter = 0;
  private storedConfig: Partial<InitializeParams> = {};
  private emit: NotificationEmitter;

  constructor(options: AgentBridgeOptions) {
    this.emit = options.emit;
  }

  // ── Public API ────────────────────────────────────────────────

  async handleRequest(method: string, params: unknown): Promise<unknown> {
    const p = (params ?? {}) as Record<string, unknown>;
    switch (method) {
      // ── Lifecycle ──
      case "initialize":
        return this.initialize(p as unknown as InitializeParams);
      case "destroy":
        return this.destroy();
      case "restoreSession":
        return this.restoreSession(p.sessionId as string);
      case "listSessions":
        return this.listSessions(p.workdir as string | undefined);
      case "getSessionInfo":
        return this.getSessionInfo();
      case "updateConfig":
        return this.updateConfig(p as unknown as UpdateConfigParams);

      // ── Messages ──
      case "sendMessage":
        return this.sendMessage(
          p as unknown as {
            text: string;
            images?: Array<{ path: string; mimeType: string }>;
            force?: boolean;
          },
        );
      case "bang":
        return this.bang(p.command as string);
      case "abortMessage":
        return this.abortMessage();
      case "clearMessages":
        return this.clearMessages();
      case "rewindToMessage":
        return this.rewindToMessage(p.messageId as string);
      case "deleteQueuedMessage":
        return this.deleteQueuedMessage(p.index as number);
      case "getMessages":
        return this.getMessages();
      case "getFullMessageThread":
        return this.getFullMessageThread();

      // ── Permissions ──
      case "setPermissionMode":
        return this.setPermissionMode(p.mode as PermissionMode);
      case "getPermissionMode":
        return this.getPermissionMode();

      // ── MCP ──
      case "getMcpServers":
        return this.getMcpServers();
      case "connectMcpServer":
        return this.connectMcpServer(p.serverName as string);
      case "disconnectMcpServer":
        return this.disconnectMcpServer(p.serverName as string);

      // ── Commands ──
      case "getSlashCommands":
        return this.getSlashCommands();

      // ── File / History ──
      case "searchFiles":
        return this.searchFiles(
          p.query as string,
          p.maxResults as number | undefined,
        );
      case "getPromptHistory":
        return this.getPromptHistory(p.workdir as string | undefined);
      case "searchPromptHistory":
        return this.searchPromptHistory(p.query as string);

      default:
        throw new RpcError(
          PROTOCOL_METHOD_NOT_FOUND,
          `Method not found: ${method}`,
        );
    }
  }

  handleNotification(method: string, params: unknown): void {
    if (method === "permissionResponse") {
      const p = params as {
        requestId: string;
        decision: PermissionDecision;
      };
      const resolve = this.pendingPermissions.get(p.requestId);
      if (resolve) {
        this.pendingPermissions.delete(p.requestId);
        resolve(p.decision);
      }
    }
  }

  // ── Lifecycle ─────────────────────────────────────────────────

  private async initialize(params: InitializeParams): Promise<{
    sessionId: string;
    workingDirectory: string;
  }> {
    // Merge with stored config (CLI defaults can be overridden by client)
    this.storedConfig = { ...this.storedConfig, ...params };

    const callbacks = this.createCallbacks();
    const options: AgentOptions = {
      callbacks,
      workdir: params.workdir,
      restoreSessionId: params.restoreSessionId,
      apiKey: params.apiKey,
      baseURL: params.baseURL,
      defaultHeaders: params.defaultHeaders,
      model: params.model,
      fastModel: params.fastModel,
      language: params.language,
      permissionMode: params.permissionMode,
      tools: params.tools,
      allowedTools: params.allowedTools,
      disallowedTools: params.disallowedTools,
      plugins: params.pluginDirs?.map((path) => ({ type: "local", path })),
      mcpServers: params.mcpServers,
      canUseTool: (context: ToolPermissionContext) => this.canUseTool(context),
    };

    this.agent = await Agent.create(options);

    return {
      sessionId: this.agent.sessionId,
      workingDirectory: this.agent.workingDirectory,
    };
  }

  private async destroy(): Promise<null> {
    if (this.agent) {
      await this.agent.destroy();
      this.agent = undefined;
    }
    return null;
  }

  private async restoreSession(sessionId: string): Promise<null> {
    this.requireAgent();
    await this.agent!.restoreSession(sessionId);
    return null;
  }

  private async listSessions(
    workdir?: string,
  ): Promise<{ sessions: SessionMetadata[] }> {
    const sessions = await listSessions(
      workdir || this.agent?.workingDirectory || process.cwd(),
    );
    return { sessions };
  }

  private getSessionInfo(): {
    sessionId: string;
    workingDirectory: string;
    latestTotalTokens: number;
    permissionMode: PermissionMode;
    availableTools: string[];
  } {
    this.requireAgent();
    return {
      sessionId: this.agent!.sessionId,
      workingDirectory: this.agent!.workingDirectory,
      latestTotalTokens: this.agent!.latestTotalTokens,
      permissionMode: this.agent!.getPermissionMode(),
      availableTools: this.agent!.getAvailableToolNames(),
    };
  }

  private async updateConfig(
    params: UpdateConfigParams,
  ): Promise<{ sessionId: string }> {
    this.requireAgent();
    const currentSessionId = this.agent!.sessionId;
    // Merge new config into stored config
    this.storedConfig = { ...this.storedConfig, ...params };
    // Destroy and recreate
    await this.agent!.destroy();
    this.agent = undefined;
    await this.initialize({
      ...this.storedConfig,
      restoreSessionId: currentSessionId,
    });
    return { sessionId: this.agent!.sessionId };
  }

  // ── Messages ──────────────────────────────────────────────────

  private async sendMessage(params: {
    text: string;
    images?: Array<{ path: string; mimeType: string }>;
    force?: boolean;
  }): Promise<null> {
    this.requireAgent();
    if (params.force) {
      this.agent!.abortMessage();
    }
    await this.agent!.sendMessage(params.text, params.images);
    return null;
  }

  private async bang(command: string): Promise<null> {
    this.requireAgent();
    await this.agent!.bang(command);
    return null;
  }

  private async abortMessage(): Promise<null> {
    this.requireAgent();
    this.agent!.abortMessage();
    return null;
  }

  private async clearMessages(): Promise<null> {
    this.requireAgent();
    this.agent!.clearMessages();
    return null;
  }

  private async rewindToMessage(messageId: string): Promise<{
    inputContent: string;
  }> {
    this.requireAgent();
    const { messages } = await this.agent!.getFullMessageThread();
    const index = messages.findIndex((m) => m.id === messageId);
    if (index === -1) {
      throw new RpcError(
        PROTOCOL_INTERNAL_ERROR,
        `Message not found: ${messageId}`,
      );
    }
    const message = messages[index];
    const textBlock = message.blocks.find((b) => b.type === "text") as
      | { content?: string }
      | undefined;
    await this.agent!.truncateHistory(index);
    return { inputContent: textBlock?.content || "" };
  }

  private deleteQueuedMessage(index: number): null {
    this.requireAgent();
    this.agent!.removeQueuedMessage(index);
    return null;
  }

  private getMessages(): { messages: Message[] } {
    this.requireAgent();
    return { messages: this.agent!.messages };
  }

  private async getFullMessageThread(): Promise<{
    messages: Message[];
    sessionIds: string[];
  }> {
    this.requireAgent();
    return this.agent!.getFullMessageThread();
  }

  // ── Permissions ───────────────────────────────────────────────

  private async setPermissionMode(mode: PermissionMode): Promise<null> {
    this.requireAgent();
    await this.agent!.setPermissionMode(mode);
    return null;
  }

  private getPermissionMode(): { mode: PermissionMode } {
    this.requireAgent();
    return { mode: this.agent!.getPermissionMode() };
  }

  // ── MCP ───────────────────────────────────────────────────────

  private getMcpServers(): { servers: McpServerStatus[] } {
    this.requireAgent();
    return { servers: this.agent!.getMcpServers() };
  }

  private async connectMcpServer(
    serverName: string,
  ): Promise<{ success: boolean }> {
    this.requireAgent();
    const success = await this.agent!.connectMcpServer(serverName);
    return { success };
  }

  private async disconnectMcpServer(
    serverName: string,
  ): Promise<{ success: boolean }> {
    this.requireAgent();
    const success = await this.agent!.disconnectMcpServer(serverName);
    return { success };
  }

  // ── Commands ──────────────────────────────────────────────────

  private getSlashCommands(): { commands: SlashCommand[] } {
    this.requireAgent();
    return { commands: this.agent!.getSlashCommands() };
  }

  // ── File / History ────────────────────────────────────────────

  private async searchFiles(
    query: string,
    maxResults?: number,
  ): Promise<{ files: Awaited<ReturnType<typeof searchFiles>> }> {
    const files = await searchFiles(query, {
      maxResults,
      workingDirectory: this.agent?.workingDirectory,
    });
    return { files };
  }

  private async getPromptHistory(workdir?: string): Promise<{
    history: Awaited<ReturnType<typeof PromptHistoryManager.getHistory>>;
  }> {
    const history = await PromptHistoryManager.getHistory({
      workdir: workdir || this.agent?.workingDirectory,
    });
    return { history };
  }

  private async searchPromptHistory(query: string): Promise<{
    history: Awaited<ReturnType<typeof PromptHistoryManager.searchHistory>>;
  }> {
    const history = await PromptHistoryManager.searchHistory(query, {
      workdir: this.agent?.workingDirectory,
    });
    return { history };
  }

  // ── canUseTool flow ───────────────────────────────────────────

  private canUseTool(
    context: ToolPermissionContext,
  ): Promise<PermissionDecision> {
    const requestId = `perm_${++this.permissionCounter}`;
    return new Promise<PermissionDecision>((resolve) => {
      this.pendingPermissions.set(requestId, resolve);
      this.emit("permissionRequest", { requestId, context });

      // 5-minute timeout → auto-deny
      setTimeout(
        () => {
          if (this.pendingPermissions.has(requestId)) {
            this.pendingPermissions.delete(requestId);
            resolve({
              behavior: "deny",
              message: "Permission request timed out",
            });
          }
        },
        5 * 60 * 1000,
      );
    });
  }

  // ── Callbacks → Notifications ─────────────────────────────────

  private createCallbacks(): AgentCallbacks {
    return {
      onMessagesChange: (messages: Message[]) => {
        this.emit("messagesChange", { messages });
      },
      onUserMessageAdded: () => {
        const msg = this.findLastUserMessage();
        if (msg) this.emit("userMessageAdded", { message: msg });
      },
      onAssistantMessageAdded: (messageId: string) => {
        const msg = this.agent?.messages.find((m) => m.id === messageId);
        if (msg) this.emit("assistantMessageAdded", { message: msg });
      },
      onAssistantContentUpdated: (params) => {
        this.emit("assistantContentUpdated", params);
      },
      onAssistantReasoningUpdated: (params) => {
        this.emit("assistantReasoningUpdated", params);
      },
      onToolBlockUpdated: (params) => {
        this.emit("toolBlockUpdated", params);
      },
      onErrorBlockAdded: (error: string) => {
        this.emit("errorBlockAdded", { error });
      },
      onLoadingChange: (loading: boolean) => {
        this.emit("loadingChange", { loading });
      },
      onCommandRunningChange: (running: boolean) => {
        this.emit("commandRunningChange", { running });
      },
      onQueuedMessagesChange: (messages: QueuedMessage[]) => {
        this.emit("queuedMessagesChange", { messages });
      },
      onTasksChange: (tasks: Task[]) => {
        this.emit("tasksChange", { tasks });
      },
      onSessionIdChange: (sessionId: string) => {
        this.emit("sessionIdChange", { sessionId });
      },
      onPermissionModeChange: (mode: PermissionMode) => {
        this.emit("permissionModeChange", { mode });
      },
      onMcpServersChange: (servers: McpServerStatus[]) => {
        this.emit("mcpServersChange", { servers });
      },
      onAddBangMessage: () => {
        this.emit("bangMessageAdded", {});
      },
      onUpdateBangMessage: () => {
        this.emit("bangMessageUpdated", {});
      },
      onCompleteBangMessage: () => {
        this.emit("bangMessageCompleted", {});
      },
      onNotificationMessageAdded: (params) => {
        this.emit("notificationMessageAdded", params);
      },
    };
  }

  private findLastUserMessage(): Message | undefined {
    const userMessages =
      this.agent?.messages.filter((m) => m.role === "user") ?? [];
    return userMessages[userMessages.length - 1];
  }

  // ── Utils ─────────────────────────────────────────────────────

  private requireAgent(): void {
    if (!this.agent) {
      throw new RpcError(PROTOCOL_INTERNAL_ERROR, "Agent not initialized");
    }
  }
}

// ── Error class for protocol errors ─────────────────────────────

export class RpcError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }

  toJsonRpcError(): JsonRpcError {
    return { code: this.code, message: this.message };
  }
}
