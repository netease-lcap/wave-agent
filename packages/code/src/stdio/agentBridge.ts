/**
 * AgentBridge — wraps the SDK Agent and translates between the JSON-RPC-like
 * stdio protocol and Agent method calls / callbacks.
 *
 * Multi-tenant: maintains a Map<sessionId, {agent, storedConfig}> so a single
 * `wave --stdio` process can host multiple sessions. Session-scoped requests
 * carry `sessionId` on the JSON-RPC envelope for routing; global requests
 * (listSessions/searchFiles/auth/plugins) don't require it but may use it
 * for workdir fallback.
 *
 * Responsibilities:
 * - Route incoming requests to the appropriate Agent method (by sessionId)
 * - Translate AgentCallbacks into outgoing notifications (with sessionId)
 * - Implement the canUseTool permission flow over the stdio protocol
 * - Handle config updates by destroying and recreating the Agent
 */

import {
  Agent,
  type AgentCallbacks,
  type AgentOptions,
  type BackgroundTask,
  type BackgroundTaskSummary,
  type SerializableWorkflowRun,
  type Message,
  type PermissionDecision,
  type PermissionMode,
  type ToolPermissionContext,
  type McpServerStatus,
  type Task,
  type QueuedMessage,
  type SessionMetadata,
  type McpServerConfig,
  type Scope,
  listSessions,
  searchFiles,
  generateRandomName,
  getDefaultRemoteBranch,
  getMessageContent,
  PromptHistoryManager,
  AuthService,
  PluginCore,
  validateWorktreeRemovalPath,
  type SlashCommand,
} from "wave-agent-sdk";
import {
  type JsonRpcError,
  INTERNAL_ERROR as PROTOCOL_INTERNAL_ERROR,
  METHOD_NOT_FOUND as PROTOCOL_METHOD_NOT_FOUND,
} from "./protocol.js";
import { execFileSync } from "node:child_process";
import { createWorktree, removeWorktree } from "../utils/worktree.js";
import { logger } from "../utils/logger.js";
import { isUserCheckpointMessage } from "../utils/rewindCheckpoints.js";

export type NotificationEmitter = (
  method: string,
  params: unknown,
  sessionId?: string,
) => void;

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
  worktreeName?: string;
  isNewWorktree?: boolean;
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

interface SearchFilesParams {
  query: string;
  maxResults?: number;
  workdir?: string;
}

interface SessionEntry {
  agent: Agent;
  storedConfig: Partial<InitializeParams>;
}

/**
 * Mutable holder so callbacks/canUseTool (created before Agent.create resolves)
 * can reference the agent and its registered sessionId after creation.
 * `registeredSessionId` is the sessionId the client knows about; it's used as
 * the envelope sessionId for outgoing notifications so the client's router can
 * demultiplex correctly. It's updated atomically when onSessionIdChange fires.
 */
interface SessionContext {
  agent?: Agent;
  registeredSessionId?: string;
}

export class AgentBridge {
  private sessions = new Map<string, SessionEntry>();
  private pendingPermissions = new Map<
    string,
    (decision: PermissionDecision) => void
  >();
  private permissionCounter = 0;
  private emit: NotificationEmitter;
  private pluginCore: PluginCore | undefined;
  private pluginCoreWorkdir: string | undefined;

  constructor(options: AgentBridgeOptions) {
    this.emit = options.emit;
  }

  // ── Public API ────────────────────────────────────────────────

  async handleRequest(
    method: string,
    params: unknown,
    sessionId?: string,
  ): Promise<unknown> {
    const p = (params ?? {}) as Record<string, unknown>;
    switch (method) {
      // ── Lifecycle ──
      case "initialize":
        return this.initialize(p as unknown as InitializeParams);
      case "destroy":
        return this.destroy(sessionId);
      case "restoreSession":
        return this.restoreSession(p.sessionId as string, sessionId);
      case "listSessions":
        return this.listSessions(p.workdir as string | undefined, sessionId);
      case "getSessionInfo":
        return this.getSessionInfo(sessionId);
      case "updateConfig":
        return this.updateConfig(p as unknown as UpdateConfigParams, sessionId);

      // ── Messages ──
      case "sendMessage":
        return this.sendMessage(
          p as unknown as {
            text: string;
            images?: Array<{ path: string; mimeType: string }>;
            force?: boolean;
          },
          sessionId,
        );
      case "bang":
        return this.bang(p.command as string, sessionId);
      case "abortMessage":
        return this.abortMessage(sessionId);
      case "clearMessages":
        return this.clearMessages(sessionId);
      case "rewindToMessage":
        return this.rewindToMessage(p.messageId as string, sessionId);
      case "listRewindCheckpoints":
        return this.listRewindCheckpoints(sessionId);
      case "deleteQueuedMessage":
        return this.deleteQueuedMessage(p.index as number, sessionId);
      case "updateQueuedMessage":
        return this.updateQueuedMessage(
          p.id as string,
          p.text as string,
          p.images as Array<{ path: string; mimeType: string }> | undefined,
          sessionId,
        );
      case "deleteQueuedMessageById":
        return this.deleteQueuedMessageById(p.id as string, sessionId);
      case "getMessages":
        return this.getMessages(sessionId);
      case "getFullMessageThread":
        return this.getFullMessageThread(sessionId);

      // ── Permissions ──
      case "setPermissionMode":
        return this.setPermissionMode(p.mode as PermissionMode, sessionId);
      case "getPermissionMode":
        return this.getPermissionMode(sessionId);

      // ── MCP ──
      case "getMcpServers":
        return this.getMcpServers(sessionId);
      case "connectMcpServer":
        return this.connectMcpServer(p.serverName as string, sessionId);
      case "disconnectMcpServer":
        return this.disconnectMcpServer(p.serverName as string, sessionId);

      // ── Commands ──
      case "getSlashCommands":
        return this.getSlashCommands(sessionId);

      // ── File / History (global — no session required) ──
      case "searchFiles":
        return this.searchFiles(p as unknown as SearchFilesParams, sessionId);
      case "getPromptHistory":
        return this.getPromptHistory(
          p.workdir as string | undefined,
          sessionId,
        );
      case "searchPromptHistory":
        return this.searchPromptHistory(
          p.query as string,
          p.workdir as string | undefined,
          sessionId,
        );

      // ── Auth (global — no session required) ──
      case "getAuthStatus":
        return this.getAuthStatus();
      case "login":
        return this.login(p.serverUrl as string | undefined);
      case "logout":
        return this.logout();

      // ── Plugins (global — no session required) ──
      case "listPlugins":
        return this.listPlugins(p.workdir as string | undefined, sessionId);
      case "installPlugin":
        return this.installPlugin(
          p.pluginId as string,
          p.scope as Scope | undefined,
          p.workdir as string | undefined,
          sessionId,
        );
      case "uninstallPlugin":
        return this.uninstallPlugin(
          p.pluginId as string,
          p.workdir as string | undefined,
          sessionId,
        );
      case "enablePlugin":
        return this.enablePlugin(
          p.pluginId as string,
          p.scope as Scope | undefined,
          p.workdir as string | undefined,
          sessionId,
        );
      case "disablePlugin":
        return this.disablePlugin(
          p.pluginId as string,
          p.scope as Scope | undefined,
          p.workdir as string | undefined,
          sessionId,
        );
      case "getProjectSettings":
        return this.getProjectSettings(
          p.workdir as string | undefined,
          sessionId,
        );
      case "setBuiltinPluginEnabled":
        return this.setBuiltinPluginEnabled(
          p.pluginId as string,
          p.enabled as boolean,
          p.scope as Scope | undefined,
          p.workdir as string | undefined,
          sessionId,
        );
      case "updatePlugin":
        return this.updatePlugin(
          p.pluginId as string,
          p.workdir as string | undefined,
          sessionId,
        );
      case "listMarketplaces":
        return this.listMarketplaces(
          p.workdir as string | undefined,
          sessionId,
        );
      case "addMarketplace":
        return this.addMarketplace(
          p.input as string,
          p.scope as Scope | undefined,
          p.workdir as string | undefined,
          sessionId,
        );
      case "removeMarketplace":
        return this.removeMarketplace(
          p.name as string,
          p.scope as Scope | undefined,
          p.workdir as string | undefined,
          sessionId,
        );
      case "updateMarketplace":
        return this.updateMarketplace(
          p.name as string | undefined,
          p.workdir as string | undefined,
          sessionId,
        );
      case "compact":
        return this.compact(
          p.customInstructions as string | undefined,
          sessionId,
        );

      // ── Background tasks ──
      case "getBackgroundTaskOutput":
        return this.getBackgroundTaskOutput(p.taskId as string, sessionId);
      case "stopBackgroundTask":
        return this.stopBackgroundTask(p.taskId as string, sessionId);

      case "getWorkflowRuns":
        return this.getWorkflowRuns(sessionId);
      case "stopWorkflowRun":
        return this.stopWorkflowRun(p.runId as string, sessionId);

      // ── Git / worktree (global — no session required) ──
      case "listGitBranches":
        return this.listGitBranches(p.workdir as string | undefined);
      case "createWorktree":
        return this.createWorktreeSession(
          p as unknown as {
            workdir: string;
            baseBranch?: string;
            name?: string;
          },
        );
      case "removeWorktree":
        return this.removeWorktreeSession(
          p as unknown as { path: string; branch: string; repoRoot: string },
        );

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
      // requestId is process-level unique; lookup doesn't need sessionId
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
    permissionMode: PermissionMode;
    latestTotalTokens: number;
  }> {
    const ctx: SessionContext = {};
    const callbacks = this.createCallbacks(ctx);

    const options: AgentOptions = {
      callbacks,
      logger,
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
      worktreeName: params.worktreeName,
      isNewWorktree: params.isNewWorktree,
      canUseTool: (context: ToolPermissionContext) =>
        this.canUseTool(context, ctx),
    };

    const agent = await Agent.create(options);
    ctx.agent = agent;
    ctx.registeredSessionId = agent.sessionId;

    this.sessions.set(agent.sessionId, {
      agent,
      storedConfig: { ...params },
    });

    return {
      sessionId: agent.sessionId,
      workingDirectory: agent.workingDirectory,
      permissionMode: agent.getPermissionMode(),
      latestTotalTokens: agent.latestTotalTokens,
    };
  }

  private async destroy(sessionId?: string): Promise<null> {
    if (sessionId) {
      const entry = this.sessions.get(sessionId);
      if (entry) {
        await entry.agent.destroy();
        this.sessions.delete(sessionId);
      }
    }
    return null;
  }

  private async restoreSession(
    restoreId: string,
    sessionId?: string,
  ): Promise<null> {
    const entry = this.requireSession(sessionId);
    await entry.agent.restoreSession(restoreId);
    return null;
  }

  private async listSessions(
    workdir?: string,
    sessionId?: string,
  ): Promise<{ sessions: SessionMetadata[] }> {
    const sessions = await listSessions(
      workdir || this.getSessionWorkdir(sessionId) || process.cwd(),
    );
    return { sessions };
  }

  // ── Git / worktree ────────────────────────────────────────────

  private listGitBranches(workdir?: string): {
    branches: string[];
    current: string | null;
  } {
    if (!workdir) {
      throw new RpcError(PROTOCOL_INTERNAL_ERROR, "workdir is required");
    }
    const gitOpts = {
      cwd: workdir,
      encoding: "utf8" as const,
      stdio: ["ignore", "pipe", "pipe"] as ["ignore", "pipe", "pipe"],
    };
    let branchesRaw: string;
    try {
      branchesRaw = execFileSync(
        "git",
        ["for-each-ref", "--format=%(refname:short)", "refs/heads"],
        gitOpts,
      ).trim();
    } catch {
      throw new RpcError(
        PROTOCOL_INTERNAL_ERROR,
        `Not a git repository (or git unavailable): ${workdir}`,
      );
    }
    const branches = branchesRaw
      ? branchesRaw
          .split("\n")
          .map((b) => b.trim())
          .filter(Boolean)
      : [];
    let current: string | null = null;
    try {
      const head = execFileSync(
        "git",
        ["rev-parse", "--abbrev-ref", "HEAD"],
        gitOpts,
      ).trim();
      // Detached HEAD prints "HEAD" — treat as no current branch.
      current = head && head !== "HEAD" ? head : null;
    } catch {
      current = null;
    }
    return { branches, current };
  }

  private async createWorktreeSession(params: {
    workdir: string;
    baseBranch?: string;
    name?: string;
  }): Promise<{
    name: string;
    path: string;
    branch: string;
    repoRoot: string;
    baseBranch: string;
    isNew: boolean;
  }> {
    if (!params.workdir) {
      throw new RpcError(PROTOCOL_INTERNAL_ERROR, "workdir is required");
    }
    const name = params.name?.trim() || generateRandomName();
    try {
      const session = await createWorktree(name, params.workdir, {
        baseBranch: params.baseBranch,
      });
      return {
        name: session.name,
        path: session.path,
        branch: session.branch,
        repoRoot: session.repoRoot,
        baseBranch: params.baseBranch ?? getDefaultRemoteBranch(params.workdir),
        isNew: session.isNew,
      };
    } catch (e) {
      throw new RpcError(PROTOCOL_INTERNAL_ERROR, (e as Error).message);
    }
  }

  private async removeWorktreeSession(params: {
    path: string;
    branch: string;
    repoRoot: string;
  }): Promise<{ ok: true }> {
    // Align with Claude Code v2.1.216+: refuse to remove a worktree whose path
    // is a symlink or resolves outside the repo root. Already-removed (missing)
    // paths pass validation so removal stays idempotent.
    try {
      validateWorktreeRemovalPath(params.path, params.repoRoot);
    } catch (e) {
      throw new RpcError(PROTOCOL_INTERNAL_ERROR, (e as Error).message);
    }

    // Trigger the WorktreeRemove hook (before git removal, non-blocking) using
    // the session that runs in this worktree, if it is still registered.
    for (const entry of this.sessions.values()) {
      if (entry.agent.workingDirectory === params.path) {
        try {
          await entry.agent.triggerWorktreeRemoveHook(params.path);
        } catch (e) {
          logger.warn("WorktreeRemove hooks execution failed:", e);
        }
        break;
      }
    }

    // removeWorktree is best-effort/idempotent: already-removed worktrees or
    // branches only log, never throw.
    await removeWorktree({
      name: "",
      path: params.path,
      branch: params.branch,
      repoRoot: params.repoRoot,
      hasUncommittedChanges: false,
      hasNewCommits: false,
      isNew: false,
    });
    return { ok: true };
  }

  private getSessionInfo(sessionId?: string): {
    sessionId: string;
    workingDirectory: string;
    latestTotalTokens: number;
    permissionMode: PermissionMode;
    availableTools: string[];
  } {
    const entry = this.requireSession(sessionId);
    return {
      sessionId: entry.agent.sessionId,
      workingDirectory: entry.agent.workingDirectory,
      latestTotalTokens: entry.agent.latestTotalTokens,
      permissionMode: entry.agent.getPermissionMode(),
      availableTools: entry.agent.getAvailableToolNames(),
    };
  }

  private async updateConfig(
    params: UpdateConfigParams,
    sessionId?: string,
  ): Promise<{ sessionId: string }> {
    const entry = this.requireSession(sessionId);
    const currentSessionId = entry.agent.sessionId;
    // Merge new config into stored config
    entry.storedConfig = { ...entry.storedConfig, ...params };
    // Destroy and recreate within the same session slot
    await entry.agent.destroy();
    this.sessions.delete(currentSessionId);

    const ctx: SessionContext = {};
    const callbacks = this.createCallbacks(ctx);
    const options: AgentOptions = {
      callbacks,
      workdir: entry.storedConfig.workdir,
      restoreSessionId: currentSessionId,
      apiKey: entry.storedConfig.apiKey,
      baseURL: entry.storedConfig.baseURL,
      defaultHeaders: entry.storedConfig.defaultHeaders,
      model: entry.storedConfig.model,
      fastModel: entry.storedConfig.fastModel,
      language: entry.storedConfig.language,
      permissionMode: entry.storedConfig.permissionMode,
      tools: entry.storedConfig.tools,
      allowedTools: entry.storedConfig.allowedTools,
      disallowedTools: entry.storedConfig.disallowedTools,
      plugins: entry.storedConfig.pluginDirs?.map((p) => ({
        type: "local",
        path: p,
      })),
      mcpServers: entry.storedConfig.mcpServers,
      // Keep worktree context (permission safety) across recreation, but never
      // re-fire WorktreeCreate — the hook ran at initial creation.
      worktreeName: entry.storedConfig.worktreeName,
      canUseTool: (context: ToolPermissionContext) =>
        this.canUseTool(context, ctx),
    };

    const agent = await Agent.create(options);
    ctx.agent = agent;
    ctx.registeredSessionId = agent.sessionId;
    this.sessions.set(agent.sessionId, {
      agent,
      storedConfig: { ...entry.storedConfig },
    });

    return { sessionId: agent.sessionId };
  }

  // ── Messages ──────────────────────────────────────────────────

  private async sendMessage(
    params: {
      text: string;
      images?: Array<{ path: string; mimeType: string }>;
      force?: boolean;
    },
    sessionId?: string,
  ): Promise<null> {
    const entry = this.requireSession(sessionId);
    if (params.force) {
      entry.agent.abortMessage();
    }
    // Save prompt to history (mirrors VSCE chatSession.ts:236-242)
    try {
      await PromptHistoryManager.addEntry(
        params.text,
        entry.agent.sessionId,
        {},
        entry.agent.workingDirectory,
      );
    } catch {
      // Best-effort; don't block message sending on history save failure
    }
    await entry.agent.sendMessage(params.text, params.images);
    return null;
  }

  private async bang(command: string, sessionId?: string): Promise<null> {
    const entry = this.requireSession(sessionId);
    await entry.agent.bang(command);
    return null;
  }

  private async abortMessage(sessionId?: string): Promise<null> {
    const entry = this.requireSession(sessionId);
    entry.agent.abortMessage();
    return null;
  }

  private async clearMessages(sessionId?: string): Promise<null> {
    const entry = this.requireSession(sessionId);
    entry.agent.clearMessages();
    return null;
  }

  private async rewindToMessage(
    messageId: string,
    sessionId?: string,
  ): Promise<{
    inputContent: string;
  }> {
    const entry = this.requireSession(sessionId);
    const { messages } = await entry.agent.getFullMessageThread();
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
    await entry.agent.truncateHistory(index);
    return { inputContent: textBlock?.content || "" };
  }

  private async listRewindCheckpoints(sessionId?: string): Promise<{
    checkpoints: Array<{ id: string; content: string }>;
  }> {
    const entry = this.requireSession(sessionId);
    const { messages } = await entry.agent.getFullMessageThread();
    const checkpoints = messages
      .filter((m) => isUserCheckpointMessage(m) && m.id)
      .map((m) => ({
        id: m.id as string,
        content: getMessageContent(m).replace(/\s+/g, " ").trim(),
      }));
    return { checkpoints };
  }

  private deleteQueuedMessage(index: number, sessionId?: string): null {
    const entry = this.requireSession(sessionId);
    entry.agent.removeQueuedMessage(index);
    return null;
  }

  private updateQueuedMessage(
    id: string,
    text: string,
    images: Array<{ path: string; mimeType: string }> | undefined,
    sessionId?: string,
  ): { ok: boolean } {
    const entry = this.requireSession(sessionId);
    const ok = entry.agent.updateQueuedMessageById(id, {
      content: text,
      images,
    });
    return { ok };
  }

  private deleteQueuedMessageById(id: string, sessionId?: string): null {
    const entry = this.requireSession(sessionId);
    entry.agent.removeQueuedMessageById(id);
    return null;
  }

  private getMessages(sessionId?: string): { messages: Message[] } {
    const entry = this.requireSession(sessionId);
    return { messages: entry.agent.messages };
  }

  private async getFullMessageThread(sessionId?: string): Promise<{
    messages: Message[];
    sessionIds: string[];
  }> {
    const entry = this.requireSession(sessionId);
    return entry.agent.getFullMessageThread();
  }

  private async compact(
    customInstructions: string | undefined,
    sessionId?: string,
  ): Promise<null> {
    const entry = this.requireSession(sessionId);
    await entry.agent.compact(customInstructions);
    return null;
  }

  // ── Background tasks ──

  private getBackgroundTaskOutput(
    taskId: string,
    sessionId?: string,
  ): { output: ReturnType<Agent["getBackgroundTaskOutput"]> } {
    const entry = this.requireSession(sessionId);
    return { output: entry.agent.getBackgroundTaskOutput(taskId) };
  }

  private stopBackgroundTask(
    taskId: string,
    sessionId?: string,
  ): { success: boolean } {
    const entry = this.requireSession(sessionId);
    const success = entry.agent.stopBackgroundTask(taskId);
    return { success };
  }

  private async getWorkflowRuns(
    sessionId?: string,
  ): Promise<{ runs: SerializableWorkflowRun[] }> {
    const entry = this.requireSession(sessionId);
    const runs = await entry.agent.getWorkflowRuns();
    return {
      runs: runs.map((r) => {
        const { completionPromise, ...rest } = r;
        void completionPromise;
        return rest;
      }),
    };
  }

  private stopWorkflowRun(
    runId: string,
    sessionId?: string,
  ): { success: boolean } {
    const entry = this.requireSession(sessionId);
    entry.agent.stopWorkflowRun(runId);
    return { success: true };
  }

  // ── Permissions ───────────────────────────────────────────────

  private async setPermissionMode(
    mode: PermissionMode,
    sessionId?: string,
  ): Promise<null> {
    const entry = this.requireSession(sessionId);
    await entry.agent.setPermissionMode(mode);
    return null;
  }

  private getPermissionMode(sessionId?: string): { mode: PermissionMode } {
    const entry = this.requireSession(sessionId);
    return { mode: entry.agent.getPermissionMode() };
  }

  // ── MCP ───────────────────────────────────────────────────────

  private getMcpServers(sessionId?: string): { servers: McpServerStatus[] } {
    const entry = this.requireSession(sessionId);
    return { servers: entry.agent.getMcpServers() };
  }

  private async connectMcpServer(
    serverName: string,
    sessionId?: string,
  ): Promise<{ success: boolean }> {
    const entry = this.requireSession(sessionId);
    const success = await entry.agent.connectMcpServer(serverName);
    return { success };
  }

  private async disconnectMcpServer(
    serverName: string,
    sessionId?: string,
  ): Promise<{ success: boolean }> {
    const entry = this.requireSession(sessionId);
    const success = await entry.agent.disconnectMcpServer(serverName);
    return { success };
  }

  // ── Commands ──────────────────────────────────────────────────

  private getSlashCommands(sessionId?: string): { commands: SlashCommand[] } {
    const entry = this.requireSession(sessionId);
    return { commands: entry.agent.getSlashCommands() };
  }

  // ── File / History (global) ───────────────────────────────────

  private async searchFiles(
    params: SearchFilesParams,
    sessionId?: string,
  ): Promise<{ files: Awaited<ReturnType<typeof searchFiles>> }> {
    const files = await searchFiles(params.query, {
      maxResults: params.maxResults,
      workingDirectory:
        params.workdir || this.getSessionWorkdir(sessionId) || process.cwd(),
    });
    return { files };
  }

  private async getPromptHistory(
    workdir?: string,
    sessionId?: string,
  ): Promise<{
    history: Awaited<ReturnType<typeof PromptHistoryManager.getHistory>>;
  }> {
    const history = await PromptHistoryManager.getHistory({
      workdir: workdir || this.getSessionWorkdir(sessionId),
    });
    return { history };
  }

  private async searchPromptHistory(
    query: string,
    workdir?: string,
    sessionId?: string,
  ): Promise<{
    history: Awaited<ReturnType<typeof PromptHistoryManager.searchHistory>>;
  }> {
    const history = await PromptHistoryManager.searchHistory(query, {
      workdir: workdir || this.getSessionWorkdir(sessionId),
    });
    return { history };
  }

  // ── canUseTool flow ───────────────────────────────────────────

  private canUseTool(
    context: ToolPermissionContext,
    ctx: SessionContext,
  ): Promise<PermissionDecision> {
    const requestId = `perm_${++this.permissionCounter}`;
    return new Promise<PermissionDecision>((resolve) => {
      this.pendingPermissions.set(requestId, resolve);
      this.emit(
        "permissionRequest",
        { requestId, context },
        ctx.registeredSessionId,
      );
    });
  }

  // ── Auth (global) ────────────────────────────────────────────

  private async getAuthStatus(): Promise<{
    isAuthenticated: boolean;
    user: { id: string; email?: string } | undefined;
    serverUrl: string;
  }> {
    const authService = AuthService.getInstance();
    return {
      isAuthenticated: authService.isSSOAuthenticated(),
      user: authService.getAuthUser(),
      serverUrl: authService.getServerUrl(),
    };
  }

  private async login(
    serverUrl?: string,
  ): Promise<{ user: { id: string; email?: string } | undefined }> {
    const authService = AuthService.getInstance();
    await authService.login({
      onAuthUrl: (url: string) => {
        this.emit("authUrl", { url });
      },
      serverUrl,
    });
    return { user: authService.getAuthUser() };
  }

  private async logout(): Promise<null> {
    const authService = AuthService.getInstance();
    await authService.clearAuth();
    return null;
  }

  // ── Plugins (global) ─────────────────────────────────────────

  private getPluginCore(workdir?: string, sessionId?: string): PluginCore {
    const resolvedWorkdir =
      workdir || this.getSessionWorkdir(sessionId) || process.cwd();
    if (!this.pluginCore || this.pluginCoreWorkdir !== resolvedWorkdir) {
      this.pluginCore = new PluginCore(resolvedWorkdir);
      this.pluginCoreWorkdir = resolvedWorkdir;
    }
    return this.pluginCore;
  }

  private async listPlugins(workdir?: string, sessionId?: string) {
    const core = this.getPluginCore(workdir, sessionId);
    const { plugins, mergedEnabled } = await core.listPlugins();
    return {
      plugins: plugins.map((p) => {
        const pluginId = `${p.name}@${p.marketplace}`;
        return {
          id: pluginId,
          name: p.name,
          description: p.description,
          marketplace: p.marketplace,
          installed: p.installed,
          version: p.version,
          enabled: mergedEnabled[pluginId] !== false,
          scope: p.scope,
        };
      }),
    };
  }

  private async installPlugin(
    pluginId: string,
    scope?: Scope,
    workdir?: string,
    sessionId?: string,
  ) {
    return this.getPluginCore(workdir, sessionId).installPlugin(
      pluginId,
      scope,
    );
  }

  private async uninstallPlugin(
    pluginId: string,
    workdir?: string,
    sessionId?: string,
  ) {
    await this.getPluginCore(workdir, sessionId).uninstallPlugin(pluginId);
    return null;
  }

  private async enablePlugin(
    pluginId: string,
    scope?: Scope,
    workdir?: string,
    sessionId?: string,
  ) {
    return this.getPluginCore(workdir, sessionId).enablePlugin(pluginId, scope);
  }

  private async disablePlugin(
    pluginId: string,
    scope?: Scope,
    workdir?: string,
    sessionId?: string,
  ) {
    return this.getPluginCore(workdir, sessionId).disablePlugin(
      pluginId,
      scope,
    );
  }

  private async getProjectSettings(
    workdir?: string,
    sessionId?: string,
  ): Promise<{ enabledPlugins: Record<string, boolean> }> {
    return {
      enabledPlugins: this.getPluginCore(
        workdir,
        sessionId,
      ).getMergedEnabledPlugins(),
    };
  }

  private async setBuiltinPluginEnabled(
    pluginId: string,
    enabled: boolean,
    scope: Scope | undefined,
    workdir?: string,
    sessionId?: string,
  ): Promise<{ enabledPlugins: Record<string, boolean> }> {
    const core = this.getPluginCore(workdir, sessionId);
    const targetScope = scope ?? "project";
    if (enabled) {
      await core.enablePlugin(pluginId, targetScope);
    } else {
      await core.disablePlugin(pluginId, targetScope);
    }
    return { enabledPlugins: core.getMergedEnabledPlugins() };
  }

  private async updatePlugin(
    pluginId: string,
    workdir?: string,
    sessionId?: string,
  ) {
    return this.getPluginCore(workdir, sessionId).updatePlugin(pluginId);
  }

  private async listMarketplaces(workdir?: string, sessionId?: string) {
    return this.getPluginCore(workdir, sessionId).listMarketplaces();
  }

  private async addMarketplace(
    input: string,
    scope?: Scope,
    workdir?: string,
    sessionId?: string,
  ) {
    return this.getPluginCore(workdir, sessionId).addMarketplace(input, scope);
  }

  private async removeMarketplace(
    name: string,
    scope?: Scope,
    workdir?: string,
    sessionId?: string,
  ) {
    await this.getPluginCore(workdir, sessionId).removeMarketplace(name, scope);
    return null;
  }

  private async updateMarketplace(
    name?: string,
    workdir?: string,
    sessionId?: string,
  ) {
    await this.getPluginCore(workdir, sessionId).updateMarketplace(name);
    return null;
  }

  // ── Callbacks → Notifications ─────────────────────────────────

  private createCallbacks(ctx: SessionContext): AgentCallbacks {
    return {
      onMessagesChange: (messages: Message[]) => {
        this.emit("messagesChange", { messages }, ctx.registeredSessionId);
      },
      onUserMessageAdded: () => {
        const msg = this.findLastUserMessage(ctx.agent);
        if (msg)
          this.emit(
            "userMessageAdded",
            { message: msg },
            ctx.registeredSessionId,
          );
      },
      onAssistantMessageAdded: (messageId: string) => {
        const msg = ctx.agent?.messages.find((m) => m.id === messageId);
        if (msg)
          this.emit(
            "assistantMessageAdded",
            { message: msg },
            ctx.registeredSessionId,
          );
      },
      onAssistantContentUpdated: (params) => {
        this.emit("assistantContentUpdated", params, ctx.registeredSessionId);
      },
      onAssistantReasoningUpdated: (params) => {
        this.emit("assistantReasoningUpdated", params, ctx.registeredSessionId);
      },
      onToolBlockUpdated: (params) => {
        this.emit("toolBlockUpdated", params, ctx.registeredSessionId);
      },
      onErrorBlockAdded: (error: string) => {
        this.emit("errorBlockAdded", { error }, ctx.registeredSessionId);
      },
      onLoadingChange: (loading: boolean) => {
        this.emit(
          "loadingChange",
          {
            loading,
            latestTotalTokens: ctx.agent?.latestTotalTokens,
          },
          ctx.registeredSessionId,
        );
      },
      onCommandRunningChange: (running: boolean) => {
        this.emit("commandRunningChange", { running }, ctx.registeredSessionId);
      },
      onQueuedMessagesChange: (messages: QueuedMessage[]) => {
        this.emit(
          "queuedMessagesChange",
          { messages },
          ctx.registeredSessionId,
        );
      },
      onTasksChange: (tasks: Task[]) => {
        this.emit("tasksChange", { tasks }, ctx.registeredSessionId);
      },
      onBackgroundTasksChange: (tasks: BackgroundTask[]) => {
        const summaries: BackgroundTaskSummary[] = tasks.map((t) => ({
          id: t.id,
          type: t.type,
          status: t.status,
          startTime: t.startTime,
          endTime: t.endTime,
          command: t.command,
          description: t.description,
          exitCode: t.exitCode,
          runtime: t.runtime,
          outputPath: t.outputPath,
        }));
        this.emit(
          "backgroundTasksChange",
          { tasks: summaries },
          ctx.registeredSessionId,
        );
      },
      onSessionIdChange: (newSessionId: string) => {
        const oldSessionId = ctx.registeredSessionId;
        // Emit with the OLD sessionId so the client's router can deliver it
        this.emit("sessionIdChange", { sessionId: newSessionId }, oldSessionId);
        // Update the sessions Map key atomically (single-threaded, no await)
        if (oldSessionId && oldSessionId !== newSessionId) {
          const entry = this.sessions.get(oldSessionId);
          if (entry) {
            this.sessions.delete(oldSessionId);
            this.sessions.set(newSessionId, entry);
          }
        }
        ctx.registeredSessionId = newSessionId;
      },
      onPermissionModeChange: (mode: PermissionMode) => {
        this.emit("permissionModeChange", { mode }, ctx.registeredSessionId);
      },
      onWorkdirChange: (newCwd: string) => {
        this.emit(
          "workdirChange",
          { workdir: newCwd },
          ctx.registeredSessionId,
        );
      },
      onMcpServersChange: (servers: McpServerStatus[]) => {
        this.emit("mcpServersChange", { servers }, ctx.registeredSessionId);
      },
      onAddBangMessage: () => {
        this.emit("bangMessageAdded", {}, ctx.registeredSessionId);
      },
      onUpdateBangMessage: () => {
        this.emit("bangMessageUpdated", {}, ctx.registeredSessionId);
      },
      onCompleteBangMessage: () => {
        this.emit("bangMessageCompleted", {}, ctx.registeredSessionId);
      },
      onNotificationMessageAdded: (params) => {
        const msg = ctx.agent?.messages.find(
          (m) =>
            m.role === "user" &&
            m.blocks.some(
              (b) =>
                b.type === "task_notification" &&
                (b as { taskId: string }).taskId === params.taskId,
            ),
        );
        this.emit(
          "notificationMessageAdded",
          { ...params, message: msg },
          ctx.registeredSessionId,
        );
      },
      onCompactBlockAdded: (content: string) => {
        this.emit("compactBlockAdded", { content }, ctx.registeredSessionId);
      },
      onCompactionStateChange: (isCompacting: boolean) => {
        this.emit(
          "compactionStateChange",
          { isCompacting },
          ctx.registeredSessionId,
        );
      },
    };
  }

  private findLastUserMessage(agent?: Agent): Message | undefined {
    const userMessages = agent?.messages.filter((m) => m.role === "user") ?? [];
    return userMessages[userMessages.length - 1];
  }

  // ── Utils ─────────────────────────────────────────────────────

  private requireSession(sessionId?: string): SessionEntry {
    if (!sessionId) {
      throw new RpcError(
        PROTOCOL_INTERNAL_ERROR,
        "sessionId is required for this request",
      );
    }
    const entry = this.sessions.get(sessionId);
    if (!entry) {
      throw new RpcError(
        PROTOCOL_INTERNAL_ERROR,
        `Session not found: ${sessionId}`,
      );
    }
    return entry;
  }

  private getSessionWorkdir(sessionId?: string): string | undefined {
    if (!sessionId) return undefined;
    return this.sessions.get(sessionId)?.agent.workingDirectory;
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
